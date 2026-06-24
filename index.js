const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const uri = process.env.MONGODB_URI;
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
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
    } catch (error) {
        console.log(error);
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
        await client.connect();
        console.log("MongoDB connected successfully! ✅");

        const db = client.db("ReadHaus");

        // ================= COLLECTIONS =================
        const usersCollection = db.collection("user");
        const booksCollection = db.collection("book");          // 🟢 মূল কালেকশন (যা Public Browse এ দেখা যাবে)
        const addBooksCollection = db.collection("addbooks");   // 🟢 লিব্রারিয়ানদের অ্যাড করা ট্র্যাক কালেকশন
        const reviewsCollection = db.collection("reviews");
        const deliveriesCollection = db.collection("deliveries");
        const wishlistsCollection = db.collection("wishlists");

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

        app.delete("/api/librarian/books/:id", async (req, res) => {
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

        app.post("/api/wishlist", async (req, res) => {
            try {
                const wishlistData = req.body;
                if (!wishlistData.userEmail || !wishlistData.bookId) {
                    return res.status(400).json({ success: false, message: "Missing required fields!" });
                }

                const isAlreadyAdded = await wishlistsCollection.findOne({
                    userEmail: wishlistData.userEmail,
                    bookId: wishlistData.bookId
                });

                if (isAlreadyAdded) {
                    return res.status(400).json({ success: false, message: "This book is already in your wishlist!" });
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



        // ================= 👑 ADMIN/PUBLIC BOOK UPDATE ROUTE (ADDED TO FIX 404) =================
        app.patch("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Book ID format" });
                }

                // মঙ্গোডিবি ক্র্যাশ এড়াতে বডি থেকে _id ফিল্ডটি বাদ দেওয়া হলো
                delete updateData._id;

                const query = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        ...updateData,
                        updatedAt: new Date()
                    }
                };

                // ওয়ান-ক্লিকে দুটি কালেকশনই আপডেট হবে যাতে ডাটা সিঙ্ক থাকে
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
                res.status(500).json({ success: false, error: "লেনদেনের তালিকা লোড করতে ব্যর্থ হয়েছে।" });
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
                res.status(500).json({ error: "পেন্ডিং বইগুলো লোড করতে ব্যর্থ হয়েছে।" });
            }
        });

        app.patch("/api/admin/book-approve/:id", async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid Book ID format" });

                const bookToApprove = await addBooksCollection.findOne({ _id: new ObjectId(id) });
                if (!bookToApprove) return res.status(404).json({ error: "বইটি খুঁজে পাওয়া যায়নি।" });

                const approvedBookDoc = {
                    ...bookToApprove,
                    status: "Published",
                    approvedAt: new Date()
                };

                // ID ডুপ্লিকেশন এরর এড়াতে ইনসার্ট করার আগে ডিলিট করা হলো
                delete approvedBookDoc._id;

                await booksCollection.updateOne(
                    { title: bookToApprove.title, author: bookToApprove.author },
                    { $set: approvedBookDoc },
                    { upsert: true }
                );

                await addBooksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "Published" } }
                );

                res.json({ success: true, message: "বইটি সফলভাবে অনুমোদিত হয়েছে!" });
            } catch (err) {
                res.status(500).json({ error: "সার্ভারে সমস্যা হয়েছে।" });
            }
        });

        app.delete("/api/admin/book-reject/:id", async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID format" });

                const result = await addBooksCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) return res.status(404).json({ error: "বইটি পাওয়া যায়নি।" });
                res.json({ success: true, message: "বইটি বাতিল করা হয়েছে।" });
            } catch (err) {
                res.status(500).json({ error: "ব্যর্থ হয়েছে।" });
            }
        });

        // ================= 👑 ADMIN USER MANAGEMENT =================

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
                const bookIds = librarianBooks.map(book => book._id.toString());

                const deliveries = await deliveriesCollection.find({ bookId: { $in: bookIds }, status: "Delivered" }).toArray();
                const totalEarnings = deliveries.reduce((sum, item) => sum + (Number(item.price || item.deliveryFee) || 0), 0);

                const activePendingRequests = await addBooksCollection.countDocuments({ librarianEmail: email, status: "Pending Approval" });

                const categoryDistribution = await addBooksCollection.aggregate([
                    { $match: { librarianEmail: email } },
                    { $group: { _id: "$category", count: { $sum: 1 } } },
                    { $project: { name: "$_id", value: "$count", _id: 0 } }
                ]).toArray();

                const mostRequestedBooks = await deliveriesCollection.aggregate([
                    { $match: { bookId: { $in: bookIds } } },
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
                res.status(500).json({ success: false, message: "Failed to fetch librarian stats" });
            }
        });

        // ================= 🚚 MANAGE DELIVERIES API =================

        app.get("/api/librarian/deliveries", async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) return res.status(400).json({ success: false, message: "Librarian email is required" });

                const myBooks = await addBooksCollection.find({ librarianEmail: email }).toArray();
                const myBookIds = myBooks.map(b => b._id.toString());

                const orders = await deliveriesCollection.find({ bookId: { $in: myBookIds } }).sort({ createdAt: -1 }).toArray();

                const formattedOrders = orders.map(order => ({
                    id: order._id,
                    sessionId: order.sessionId,
                    clientName: order.userName || "Regular Client",
                    bookTitle: order.bookTitle || "Untitled Book",
                    date: order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "N/A",
                    status: order.status || "Pending"
                }));

                res.status(200).json({ success: true, data: formattedOrders });
            } catch (err) {
                res.status(500).json({ success: false, message: "Failed to fetch delivery logs." });
            }
        });

        app.patch('/api/librarian/deliveries/update-status', verifyToken, async (req, res) => {
            try {
                const { id, status } = req.body;
                if (!["Pending", "Dispatched", "Delivered"].includes(status)) {
                    return res.status(400).json({ success: false, message: "Invalid status state!" });
                }

                const result = await deliveriesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: status } }
                );

                res.json({ success: true, message: `Delivery status updated to ${status}`, modifiedCount: result.modifiedCount });
            } catch (err) {
                res.status(500).json({ success: false, message: "Server error during status shift." });
            }
        });

        // ================= PUBLIC DELIVERIES ROUTE =================
        // ================= PUBLIC DELIVERIES ROUTE (FIXED STATUS FOR PENDING) =================
        app.post('/api/deliveries', async (req, res) => {
            try {
                const data = req.body;

                // 🛠️ ফিক্স: নতুন অর্ডার তৈরি হওয়ার সময় স্ট্যাটাস ডিফল্টভাবে "Pending" থাকবে
                const newDelivery = {
                    ...data,
                    status: "Pending", // লিব্রারিয়ান এপ্রুভ করার আগে এটি Pending দেখাবে
                    createdAt: new Date()
                };

                await deliveriesCollection.insertOne(newDelivery);
                res.json({ success: true, message: "Delivery request submitted as Pending!" });
            } catch (err) {
                console.error("Delivery post error:", err);
                res.status(500).json({ success: false, message: "Server error during delivery post" });
            }
        });

        app.patch('/api/deliveries/update-status', async (req, res) => {
            const { sessionId, status } = req.body;
            const result = await deliveriesCollection.updateOne({ sessionId: sessionId }, { $set: { status: status } });
            res.json({ success: true, modifiedCount: result.modifiedCount });
        });

        // ================= 📚 PUBLIC BROWSE BOOKS API (FIXED ALL FILTERS) =================
        app.get("/api/books", async (req, res) => {
            try {
                const { search, category, availability, maxFee, page = 1, limit = 6 } = req.query;

                // ১. ডিফল্ট কুয়েরি (শুধুমাত্র Published বই সাধারণ ইউজাররা দেখবে)
                let query = { status: "Published" };

                // ২. সার্চ ফিল্টার
                if (search && search.trim() !== "") {
                    query.$or = [
                        { title: { $regex: search, $options: "i" } },
                        { author: { $regex: search, $options: "i" } }
                    ];
                }

                // ৩. ক্যাটাগরি ফিল্টার (🛠️ ফিক্স: 'All' ভ্যালু সফলভাবে হ্যান্ডেল করা হয়েছে)
                if (category && category !== "All") {
                    const cleanCategory = category.split(" ")[0];
                    query.category = { $regex: cleanCategory, $options: "i" };
                }

                // ৪. স্ট্যাটাস/অ্যাভেইলেবিলিটি ফিল্টার (🛠️ ফিক্স: 'All' ভ্যালু সফলভাবে হ্যান্ডেল করা হয়েছে)
                if (availability && availability !== "All") {
                    query.status = availability;
                }

                // ৫. ডেলিভারি ফি ফিল্টার
                if (maxFee) {
                    query.deliveryFee = { $lte: parseFloat(maxFee) };
                }

                // ৬. পেজিনেশন লজিক
                const pageNumber = parseInt(page);
                const limitNumber = parseInt(limit);
                const skip = (pageNumber - 1) * limitNumber;

                const totalBooks = await booksCollection.countDocuments(query);
                const books = await booksCollection.find(query)
                    .skip(skip)
                    .limit(limitNumber)
                    .toArray();

                const totalPages = Math.ceil(totalBooks / limitNumber);

                res.status(200).json({
                    success: true,
                    data: books,
                    totalPages: totalPages || 1,
                    totalBooks
                });

            } catch (err) {
                console.error("Error fetching public books:", err);
                res.status(500).json({ success: false, message: "Server error while fetching books." });
            }
        });

        app.get("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { email } = req.query;

                const book = await booksCollection.findOne({ _id: new ObjectId(id) });
                if (!book) return res.status(404).json({ error: "Book not found" });

                let isPurchased = false;
                if (email) {
                    const purchaseCheck = await deliveriesCollection.findOne({ bookId: id, userEmail: email, status: "Delivered" });
                    if (purchaseCheck) isPurchased = true;
                }

                const bookReviews = await reviewsCollection.find({ bookId: new ObjectId(id) }).sort({ dateAdded: -1 }).toArray();
                book.reviews = bookReviews;
                book.isPurchased = isPurchased;

                res.json(book);
            } catch (err) {
                res.status(500).json({ error: "Invalid ID or server error" });
            }
        });

    } finally {
        // client.close(); 
    }
}
run().catch(console.dir);

// Root Route
app.get("/", (req, res) => {
    res.send("ReadHaus Server is Running!");
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});