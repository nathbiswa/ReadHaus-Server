const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const uri = process.env.MONGODB_URI;
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ CORS ফিক্স: নির্দিষ্ট অরিজিন এবং ক্রেডেন্সিয়াল অ্যালাউ করা হলো
app.use(
    cors({
        origin: ["https://read-haus-client.vercel.app", "http://localhost:3000"], // আপনার ফ্রন্টএন্ডের URL
        credentials: true,               // সেশন/কুকি/ক্রেডেন্সিয়াল অ্যালাউ করার জন্য
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL || "http://localhost:3000"}/api/auth/jwks`)
);

// ✅ Verified standard token validation middleware
const verifyToken = async (req, res, next) => {
    const authHeader = req?.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    try {
        const { payload } = await jwtVerify(token, JWKS);
        req.decoded = payload;
        next();
    } catch (err) {
        console.error("JWT verification error:", err);
        return res.status(401).json({ message: "Unauthorized" });
    }
};

// Mongo Client
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        // await client.connect();
        console.log("MongoDB connected successfully! ✅");

        const db = client.db("ReadHaus");

        // ================= COLLECTIONS =================
        const usersCollection = db.collection("user");
        const booksCollection = db.collection("book");          // 🟢 মূল কালেকশন (যা Public Browse এ দেখা যাবে)
        const addBooksCollection = db.collection("addbooks");   // 🟢 লিব্রারিয়ানদের অ্যাড করা ট্র্যাক কালেকশন
        const reviewsCollection = db.collection("reviews");
        const deliveriesCollection = db.collection("deliveries");
        const wishlistsCollection = db.collection("wishlists");

        // ================= 🎯 🆕 CHECK PURCHASE STATUS API (বাটন ডিজেবল করার জন্য) =================
        app.get("/api/check-purchase", async (req, res) => {
            try {
                const { email, bookId } = req.query;
                if (!email || !bookId) {
                    return res.status(400).json({ hasPurchased: false, message: "Missing params" });
                }

                // ডেলভারি কালেকশনে এই ইউজার এবং এই বইয়ের কোনো রেকর্ড আছে কিনা খোঁজা হচ্ছে
                const existingPurchase = await deliveriesCollection.findOne({
                    userEmail: email,
                    bookId: bookId
                });

                if (existingPurchase) {
                    return res.status(200).json({ hasPurchased: true });
                } else {
                    return res.status(200).json({ hasPurchased: false });
                }
            } catch (err) {
                console.error("Check purchase error:", err);
                res.status(500).json({ hasPurchased: false });
            }
        });


        // ================= 🚚 LIBRARIAN MANAGE DELIVERIES GET API =================
        app.get("/api/librarian/deliveries", verifyToken, async (req, res) => {
            try {
                const { email } = req.query; // 🟢 ফ্রন্টএন্ড কোড অনুযায়ী কুয়েরি প্যারামিটার থেকে নেওয়া হচ্ছে

                if (!email) {
                    return res.status(400).json({ success: false, message: "Librarian email is required!" });
                }

                // deliveries কালেকশন থেকে এই লিব্রারিয়ানের আন্ডারে থাকা সব অর্ডার খোঁজা হচ্ছে
                const orders = await deliveriesCollection
                    .find({ librarianEmail: email })
                    .sort({ createdAt: -1 }) // নতুন রিকোয়েস্টগুলো আগে দেখাবে
                    .toArray();

                // ফ্রন্টএন্ডের প্রত্যাশা অনুযায়ী `success: true` এবং `data` অবজেক্ট পাঠানো হচ্ছে
                res.status(200).json({
                    success: true,
                    data: orders
                });

            } catch (err) {
                console.error("Fetch librarian deliveries error:", err);
                res.status(500).json({ success: false, message: "Internal server error while fetching deliveries." });
            }
        });

        // ================= ⚡ UPDATE LIBRARIAN DELIVERY STATUS API =================
        app.patch("/api/librarian/orders/:id/status", verifyToken, async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body; // ফ্রন্টএন্ড থেকে বডিতে "Dispatched" বা "Delivered" আসবে

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Order ID format" });
                }
                if (!status) {
                    return res.status(400).json({ success: false, message: "Status is required" });
                }

                const query = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        status: status, // ডাটাবেজে স্ট্যাটাস আপডেট হবে (যেমন: Dispatched বা Delivered)
                        updatedAt: new Date()
                    }
                };

                const result = await deliveriesCollection.updateOne(query, updateDoc);

                if (result.matchedCount === 0) {
                    return res.status(404).json({ success: false, message: "Order not found" });
                }

                res.status(200).json({
                    success: true,
                    message: `Status successfully updated to ${status}`
                });

            } catch (err) {
                console.error("Update delivery status error:", err);
                res.status(500).json({ success: false, message: "Failed to update delivery status." });
            }
        });

        // ================= 💳 PAYMENTS & DELIVERY REQUEST API =================
        app.post("/api/payments", async (req, res) => {
            try {
                const { bookId, title, userEmail, userName, price, status, librarianEmail } = req.body;

                if (!userEmail || !bookId) {
                    return res.status(400).json({ success: false, message: "Missing required tracking info!" });
                }

                const newDeliveryDoc = {
                    bookId: bookId,
                    bookTitle: title,
                    userEmail: userEmail,
                    userName: userName,
                    price: Number(price) || 0,
                    status: "Pending",
                    librarianEmail: librarianEmail || "", // 🟢 এখানে লাইব্রেরিয়ান ইমেইল ডাটাবেজে সেভ হচ্ছে
                    createdAt: new Date(),
                    sessionId: `TXN-${Date.now()}`
                };

                const result = await deliveriesCollection.insertOne(newDeliveryDoc);

                res.status(201).json({
                    success: true,
                    message: "Delivery request submitted as Pending!",
                    insertedId: result.insertedId
                });

            } catch (err) {
                console.error("Payment API error:", err);
                res.status(500).json({ success: false, message: "Internal server error during payment request." });
            }
        });


        // ================= 📚 LIBRARIAN INVENTORY & MANAGE API =================
        app.get("/api/librarian/books", async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) return res.status(400).json({ success: false, message: "Email required" });

                const result = await addBooksCollection.find({ librarianEmail: email }).sort({ createdAt: -1 }).toArray();

                res.status(200).json({
                    success: true,
                    data: result
                });
            } catch (err) {
                res.status(500).json({ success: false, message: "Failed to load" });
            }
        });

        app.put("/api/librarian/books/:id", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                const updatedData = req.body;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Book ID" });
                }

                const query = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        title: updatedData.title,
                        author: updatedData.author,
                        description: updatedData.description,
                        category: updatedData.category,
                        deliveryFee: parseFloat(updatedData.deliveryFee),
                        image: updatedData.image,
                        updatedAt: new Date()
                    }
                };

                await addBooksCollection.updateOne(query, updateDoc);
                await booksCollection.updateOne(query, updateDoc);

                res.status(200).json({ success: true, message: "Book updated successfully!" });
            } catch (err) {
                console.error("Librarian book update error:", err);
                res.status(500).json({ success: false, message: "Failed to update book." });
            }
        });

        app.delete("/api/librarian/books/:id", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Book ID format" });
                }

                const query = { _id: new ObjectId(id) };

                await addBooksCollection.deleteOne(query);
                await booksCollection.deleteOne(query);

                res.status(200).json({ success: true, message: "Book deleted from inventory successfully!" });
            } catch (err) {
                console.error("Librarian book DELETE error:", err);
                res.status(500).json({ success: false, message: "Server error while deleting the book." });
            }
        });

        app.patch("/api/librarian/books/:id/toggle-status", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;
                const { status } = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Book ID" });
                }

                const book = await addBooksCollection.findOne({ _id: new ObjectId(id) });
                if (!book) return res.status(404).json({ success: false, message: "Book not found" });

                if (book.status === "Pending Approval") {
                    return res.status(403).json({ success: false, message: "You cannot change status of a pending book!" });
                }

                await addBooksCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: status } });

                if (status === "Published") {
                    const publishedDoc = { ...book, status: "Published", _id: new ObjectId(id) };
                    await booksCollection.updateOne({ _id: new ObjectId(id) }, { $set: publishedDoc }, { upsert: true });
                } else {
                    await booksCollection.deleteOne({ _id: new ObjectId(id) });
                }

                res.status(200).json({ success: true, message: `Book successfully changed to ${status}` });
            } catch (err) {
                console.error("Toggle status error:", err);
                res.status(500).json({ success: false, message: "Failed to toggle status." });
            }
        });

        // ================= ❤️ WISHLIST API ROUTES =================
        app.post("/api/wishlist", verifyToken, async (req, res) => {
            try {
                const wishlistData = req.body;

                // 🌟 ১. Security Check
                const decodedEmail = req.decoded?.email || req.user?.email;
                if (decodedEmail && wishlistData.userEmail !== decodedEmail) {
                    return res.status(403).json({ success: false, message: "Forbidden access! Email mismatch." });
                }

                if (!wishlistData.userEmail || !wishlistData.bookId) {
                    return res.status(400).json({ success: false, message: "Missing required fields!" });
                }

                const isAlreadyAdded = await wishlistsCollection.findOne({
                    userEmail: wishlistData.userEmail,
                    bookId: wishlistData.bookId
                });

                if (isAlreadyAdded) {
                    return res.status(400).json({
                        success: false,
                        message: "This book is already in your wishlist!"
                    });
                }

                await wishlistsCollection.insertOne({
                    ...wishlistData,
                    addedAt: new Date()
                });

                res.status(201).json({ success: true, message: "Book added to wishlist successfully!" });

            } catch (err) {
                console.error("Wishlist POST error:", err);
                res.status(500).json({ success: false, message: "Internal server error!" });
            }
        });

        app.get("/api/user-wishlist", async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ success: false, message: "User email is required!" });

                const result = await wishlistsCollection.find({ userEmail: email }).sort({ addedAt: -1 }).toArray();
                res.status(200).json({ success: true, data: result });
            } catch (err) {
                res.status(500).json({ success: false, message: "Failed to load wishlist items." });
            }
        });

        app.delete("/api/wishlist/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await wishlistsCollection.deleteOne(query);

                if (result.deletedCount === 1) {
                    res.status(200).json({ success: true, message: "Removed from wishlist successfully!" });
                } else {
                    res.status(404).json({ success: false, message: "Item not found in wishlist!" });
                }
            } catch (err) {
                res.status(500).json({ success: false, message: "Server error while removing from wishlist." });
            }
        });

        // ================= 📊 USER DASHBOARD OVERVIEW DATA =================
        app.get("/api/user-summary", async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ success: false, message: "User email is required!" });

                const userDeliveries = await deliveriesCollection.find({ userEmail: email }).toArray();

                let booksReadCount = 0;
                let pendingCount = 0;
                let totalSpent = 0;

                userDeliveries.forEach(item => {
                    const currentStatus = (item.status || "").trim().toLowerCase();
                    if (["complete", "read", "delivered", "completed"].includes(currentStatus)) {
                        booksReadCount++;
                    } else if (["pending", "processing", "ordered"].includes(currentStatus)) {
                        pendingCount++;
                    }
                    totalSpent += Number(item.price) || 0;
                });

                res.status(200).json({
                    success: true,
                    data: {
                        booksRead: booksReadCount,
                        pendingDeliveries: pendingCount,
                        totalSpent: parseFloat(totalSpent.toFixed(2))
                    }
                });
            } catch (err) {
                res.status(500).json({ success: false, message: "Failed to fetch activity summary." });
            }
        });

        app.get("/api/user-deliveries", async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ success: false, message: "User email is required!" });

                const result = await deliveriesCollection.find({ userEmail: email }).sort({ createdAt: -1 }).toArray();
                res.status(200).json({ success: true, data: result });
            } catch (err) {
                res.status(500).json({ success: false, message: "Failed to fetch delivery history data." });
            }
        });

        // ================= ⭐ USER REVIEWS API ROUTES =================
        app.get("/api/user-reviews", async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ success: false, message: "User email is required!" });
                const result = await reviewsCollection.find({ userEmail: email }).sort({ createdAt: -1 }).toArray();
                res.status(200).json({ success: true, data: result });
            } catch (err) {
                res.status(500).json({ success: false, message: "Failed to load user reviews." });
            }
        });

        app.delete("/api/reviews/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 1) {
                    res.status(200).json({ success: true, message: "Review deleted successfully!" });
                } else {
                    res.status(404).json({ success: false, message: "Review not found!" });
                }
            } catch (err) {
                res.status(500).json({ success: false, message: "Server error while deleting review." });
            }
        });

        // ================== 📚 LIBRARIAN ADD BOOK ROUTE ==================
        app.post("/api/librarian/addbook", verifyToken, async (req, res) => {
            try {
                const bookData = req.body;
                const librarianEmail = bookData.librarianEmail || req.decoded?.email;

                if (!bookData.title || !bookData.author || !bookData.deliveryFee) {
                    return res.status(400).json({ success: false, message: "প্রয়োজনীয় তথ্যগুলো প্রদান করুন।" });
                }

                const newBookDoc = {
                    title: bookData.title,
                    author: bookData.author,
                    description: bookData.description,
                    category: bookData.category,
                    deliveryFee: parseFloat(bookData.deliveryFee),
                    image: bookData.image || "default-link",
                    librarian: bookData.librarian || "Unknown Librarian",
                    librarianEmail: librarianEmail,
                    status: "Pending Approval",
                    createdAt: new Date()
                };

                const result = await addBooksCollection.insertOne(newBookDoc);
                res.status(201).json({ success: true, message: "বইটি সফলভাবে যুক্ত হয়েছে!", result });
            } catch (error) {
                res.status(500).json({ success: false, message: "সার্ভার ত্রুটি!" });
            }
        });

        // ================= 📚 ADVANCED BROWSE BOOKS API =================
        app.get("/api/books", async (req, res) => {
            try {
                const { search, category, availability, maxFee, page, limit } = req.query;

                const currentPage = parseInt(page) || 1;
                const currentLimit = parseInt(limit) || 4;
                const skip = (currentPage - 1) * currentLimit;

                let queryFilter = {};

                if (search && search.trim() !== "") {
                    const searchRegex = { $regex: search.trim(), $options: "i" };
                    queryFilter.$or = [
                        { title: searchRegex },
                        { author: searchRegex }
                    ];
                }

                if (category && category !== "All") {
                    queryFilter.category = { $regex: category, $options: "i" };
                }

                if (availability && availability !== "All") {
                    queryFilter.status = availability;
                }

                if (maxFee) {
                    queryFilter.deliveryFee = { $lte: parseFloat(maxFee) };
                }

                const totalBooks = await booksCollection.countDocuments(queryFilter);

                const books = await booksCollection.find(queryFilter)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(currentLimit)
                    .toArray();

                res.status(200).json({
                    success: true,
                    data: books,
                    total: totalBooks,
                    page: currentPage,
                    limit: currentLimit,
                    totalPages: Math.ceil(totalBooks / currentLimit)
                });

            } catch (err) {
                console.error("Advanced Browse Books API Error:", err);
                res.status(500).json({ success: false, message: "Server error while fetching books." });
            }
        });

        // ================= 📚 GET ALL DETAILS OF A SINGLE BOOK =================
        app.get("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Book ID format" });
                }

                const query = { _id: new ObjectId(id) };

                let book = await booksCollection.findOne(query);

                if (!book) {
                    book = await addBooksCollection.findOne(query);
                }

                if (!book) {
                    return res.status(404).json({ success: false, message: "Book not found!" });
                }

                res.status(200).json(book);

            } catch (err) {
                console.error("Fetch single book full data error:", err);
                res.status(500).json({ success: false, message: "Internal server error" });
            }
        });

        // ================= 👑 ADMIN/PUBLIC BOOK UPDATE ROUTE =================
        app.patch("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Book ID format" });
                }

                delete updateData._id;

                const query = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        ...updateData,
                        updatedAt: new Date()
                    }
                };

                const resultBooks = await booksCollection.updateOne(query, updateDoc);
                const resultAddBooks = await addBooksCollection.updateOne(query, updateDoc);

                if (resultBooks.matchedCount === 0 && resultAddBooks.matchedCount === 0) {
                    return res.status(404).json({ success: false, message: "Book not found in database" });
                }

                res.status(200).json({
                    success: true,
                    message: "Book status/data updated successfully by Admin!"
                });

            } catch (err) {
                console.error("Admin book update error:", err);
                res.status(500).json({ success: false, message: "Internal server error while updating book" });
            }
        });

        // ================= 👑 ADMIN API ROUTES =================
        app.get("/api/admin/transactions", async (req, res) => {
            try {
                const deliveries = await deliveriesCollection.find().sort({ createdAt: -1 }).toArray();
                const formattedTransactions = deliveries.map(item => ({
                    id: item._id,
                    transactionId: item.sessionId || `TXN-${item._id.toString().substring(0, 10).toUpperCase()}`,
                    userName: item.userName || "Regular User",
                    userEmail: item.userEmail || "No Email",
                    librarianName: item.librarianName || "Main Library",
                    librarianEmail: item.librarianEmail || "library@readhaus.com",
                    bookTitle: item.bookTitle || "Purchased Book",
                    amount: Number(item.price) || 0,
                    date: item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Recent",
                    status: item.status || "Pending"
                }));
                res.status(200).json({ success: true, data: formattedTransactions });
            } catch (err) {
                res.status(500).json({ success: false, error: "FAILED" });
            }
        });

        app.get("/api/admin/dashboard-stats", async (req, res) => {
            try {
                const totalUsers = await usersCollection.countDocuments();
                const totalBooks = await addBooksCollection.countDocuments();
                const totalDeliveries = await deliveriesCollection.countDocuments();

                const deliveries = await deliveriesCollection.find().toArray();
                const totalRevenue = deliveries.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

                const categoryData = await addBooksCollection.aggregate([
                    { $group: { _id: "$category", count: { $sum: 1 } } },
                    { $project: { name: "$_id", value: "$count", _id: 0 } }
                ]).toArray();

                res.status(200).json({
                    totalUsers,
                    totalBooks,
                    totalDeliveries,
                    totalRevenue: totalRevenue.toFixed(2),
                    chartData: categoryData
                });
            } catch (err) {
                res.status(500).json({ error: "Failed to fetch dashboard stats" });
            }
        });

        app.get("/api/admin/book-approvals", async (req, res) => {
            try {
                const pendingBooks = await addBooksCollection.find({ status: "Pending Approval" }).sort({ createdAt: -1 }).toArray();
                res.json(pendingBooks);
            } catch (err) {
                res.status(500).json({ error: "PENDING FAILED" });
            }
        });

        app.patch("/api/admin/book-approve/:id", async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid Book ID format" });

                const bookToApprove = await addBooksCollection.findOne({ _id: new ObjectId(id) });
                if (!bookToApprove) return res.status(404).json({ error: "NOT FOUND" });

                const approvedBookDoc = {
                    title: bookToApprove.title,
                    author: bookToApprove.author,
                    description: bookToApprove.description,
                    category: bookToApprove.category,
                    deliveryFee: parseFloat(bookToApprove.deliveryFee),
                    image: bookToApprove.image,
                    librarian: bookToApprove.librarian,
                    librarianEmail: bookToApprove.librarianEmail,
                    status: "Published",
                    approvedAt: new Date()
                };

                await booksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { ...approvedBookDoc } },
                    { upsert: true }
                );

                await addBooksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "Published" } }
                );

                res.json({ success: true, message: "APPROVED WITH ALL DATA" });
            } catch (err) {
                console.error("Approval error:", err);
                res.status(500).json({ error: "SERVER ERROR" });
            }
        });

        app.delete("/api/admin/book-reject/:id", async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID format" });

                const result = await addBooksCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) return res.status(404).json({ error: "NOT FOUND" });
                res.json({ success: true, message: "REJECTED" });
            } catch (err) {
                res.status(500).json({ error: "FAILED" });
            }
        });

        app.get("/api/admin/users", async (req, res) => {
            try {
                const users = await usersCollection.find().toArray();
                res.status(200).json(users);
            } catch (err) {
                res.status(500).json({ error: "Failed to fetch users" });
            }
        });

        app.delete("/api/admin/user/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) return res.status(404).json({ error: "User not found" });
                res.json({ success: true, message: "User deleted successfully" });
            } catch (err) {
                res.status(500).json({ error: "Failed to delete user" });
            }
        });

        app.patch("/api/admin/user-role/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { role } = req.body;
                await usersCollection.updateOne({ _id: new ObjectId(id) }, { $set: { role: role } });
                res.json({ success: true, message: "Role updated" });
            } catch (err) {
                res.status(500).json({ error: "Failed to update role" });
            }
        });

        // ================= 📚 LIBRARIAN OVERVIEW STATS API =================
        app.get("/api/librarian-stats", async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) return res.status(400).json({ success: false, message: "Email is required" });

                const totalBooksListed = await addBooksCollection.countDocuments({ librarianEmail: email });
                const librarianBooks = await addBooksCollection.find({ librarianEmail: email }).toArray();

                const bookIdStrings = librarianBooks.map(book => book._id.toString());
                const bookIdObjects = librarianBooks.map(book => new ObjectId(book._id));
                const allPossibleBookIds = [...bookIdStrings, ...bookIdObjects];

                const deliveries = await deliveriesCollection.find({
                    $or: [
                        { librarianEmail: email },
                        { bookId: { $in: allPossibleBookIds } }
                    ]
                }).toArray();

                const totalEarnings = deliveries.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

                const activePendingRequests = await deliveriesCollection.countDocuments({
                    $or: [
                        { librarianEmail: email },
                        { bookId: { $in: allPossibleBookIds } }
                    ],
                    status: { $regex: /^pending$/i }
                });

                const categoryDistribution = await addBooksCollection.aggregate([
                    { $match: { librarianEmail: email } },
                    { $group: { _id: "$category", count: { $sum: 1 } } },
                    { $project: { name: "$_id", value: "$count", _id: 0 } }
                ]).toArray();

                const mostRequestedBooks = await deliveriesCollection.aggregate([
                    { $match: { bookId: { $in: allPossibleBookIds } } },
                    { $group: { _id: "$bookId", bookTitle: { $first: "$bookTitle" }, requestCount: { $sum: 1 } } },
                    { $sort: { requestCount: -1 } },
                    { $limit: 5 },
                    { $project: { _id: 1, title: "$bookTitle", requestCount: 1 } }
                ]).toArray();

                res.status(200).json({
                    success: true,
                    data: {
                        totalBooksListed,
                        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
                        activePendingRequests,
                        categoryDistribution,
                        mostRequestedBooks
                    }
                });

            } catch (err) {
                console.error("Librarian stats API error:", err);
                res.status(500).json({ success: false, message: "Failed to fetch librarian stats" });
            }
        });

    } finally {
        // Enforces that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("ReadHaus Server is running... 🚀");
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
