// const dns = require('node:dns');
// dns.setServers(['1.1.1.1', '1.0.0.1']);

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
app.use(express.urlencoded({ extended: true })); // URL encoded ডেটা নিরাপদে পার্স করার জন্য

const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);

// ✅ Verified standard token validation middleware
const verifyToken = async (req, res, next) => {
    const authHeader = req?.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    console.log(authHeader);
    const token = authHeader.split(' ')[1];
    console.log(token);
    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const { payload } = await jwtVerify(token, JWKS);
        console.log(payload);
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
        const db = client.db("ReadHaus");

        // ================= COLLECTIONS =================
        const usersCollection = db.collection("user");
        const booksCollection = db.collection("books");
        const reviewsCollection = db.collection("reviews");
        const deliveriesCollection = db.collection("deliveries");
        const addBooksCollection = db.collection("addbooks");
        const wishlistsCollection = db.collection("wishlists");

        // ================= ❤️ WISHLIST COLLECTION =================

        // 1. Add a new book to wishlist (POST)
        app.post("/api/wishlist", async (req, res) => {
            try {
                const wishlistData = req.body;

                const isAlreadyAdded = await wishlistsCollection.findOne({
                    userEmail: wishlistData.userEmail,
                    bookId: wishlistData.bookId
                });

                if (isAlreadyAdded) {
                    return res.status(400).json({ success: false, message: "This book is already in your wishlist!" });
                }

                const result = await wishlistsCollection.insertOne({
                    ...wishlistData,
                    addedAt: new Date()
                });

                res.status(201).json({ success: true, message: "Book added to wishlist successfully!", result });
            } catch (err) {
                console.error("Wishlist POST error:", err);
                res.status(500).json({ success: false, message: "Internal server error! Failed to add to wishlist." });
            }
        });

        // 2. Fetch specific user's wishlist data (GET)
        app.get("/api/wishlist", async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).json({ success: false, message: "User email is required!" });
                }

                const result = await wishlistsCollection.find({ userEmail: email }).toArray();
                res.status(200).json({ success: true, data: result });
            } catch (err) {
                console.error("Wishlist GET error:", err);
                res.status(500).json({ success: false, message: "Failed to fetch wishlist data." });
            }
        });

        // ================= 📊 USER DASHBOARD OVERVIEW DATA =================

        app.get("/api/user-summary", async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).json({ success: false, message: "User email is required!" });
                }

                // ১. ডাটাবেজ থেকে লগইন করা ইউজারের সব ডেলিভারি ডাটা আনা
                const userDeliveries = await deliveriesCollection.find({ userEmail: email }).toArray();

                let booksReadCount = 0;
                let pendingCount = 0;
                let totalSpent = 0;

                // ২. লুপ চালিয়ে মঙ্গোডিবির অবজেক্ট থেকে ডেটা কাউন্ট এবং ক্যালকুলেট করা
                userDeliveries.forEach(item => {
                    // স্ট্যাটাস ফিল্ডের টেক্সট ট্রিম ও লোয়ারকেস করা হলো যাতে স্পেস বা কেস-সেন্সিটিভ ইস্যু না হয়
                    const currentStatus = (item.status || "").trim().toLowerCase();

                    // Books Read কাউন্ট
                    if (["complete", "read", "delivered", "completed"].includes(currentStatus)) {
                        booksReadCount++;
                    }
                    // Pending Deliveries কাউন্ট
                    else if (["pending", "processing", "ordered"].includes(currentStatus)) {
                        pendingCount++;
                    }

                    // Total Spent হিসাব (স্ট্রিং "65" কে নাম্বারে রূপান্তর করা)
                    const cost = Number(item.price) || 0;
                    totalSpent += cost;
                });

                // ৩. ফ্রন্টঅ্যান্ডের নির্দিষ্ট প্যাটার্ন অনুযায়ী রেসপন্স পাঠানো
                res.status(200).json({
                    success: true,
                    message: "User dashboard activities summary fetched successfully",
                    data: {
                        booksRead: booksReadCount,
                        pendingDeliveries: pendingCount,
                        totalSpent: parseFloat(totalSpent.toFixed(2))
                    }
                });
            } catch (err) {
                console.error("User summary GET error:", err);
                res.status(500).json({ success: false, message: "Internal server error! Failed to fetch activity summary." });
            }
        });


        // ================= 🚚 USER DELIVERY HISTORY DATA =================

        app.get("/api/user-deliveries", async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).json({ success: false, message: "User email is required!" });
                }

                // ডাটাবেজ থেকে নির্দিষ্ট ইউজারের সব ডেলিভারি ডেটা লেটেস্ট ডেট অনুযায়ী খুঁজে বের করা
                const result = await deliveriesCollection
                    .find({ userEmail: email })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.status(200).json({
                    success: true,
                    message: "User deliveries fetched successfully",
                    data: result
                });
            } catch (err) {
                console.error("User deliveries GET error:", err);
                res.status(500).json({ success: false, message: "Failed to fetch delivery history data." });
            }
        });


        // ================= ⭐ USER REVIEWS API ROUTES =================

        // ১. নির্দিষ্ট ইউজারের রিভিউ লিস্ট পাওয়ার রুট
        app.get("/api/user-reviews", async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) {
                    return res.status(400).json({ success: false, message: "User email is required!" });
                }

                const result = await reviewsCollection
                    .find({ userEmail: email })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.status(200).json({ success: true, data: result });
            } catch (err) {
                console.error("User reviews GET error:", err);
                res.status(500).json({ success: false, message: "Failed to load user reviews." });
            }
        });

        // ২. নির্দিষ্ট রিভিউ ডিলিট করার রুট
        app.delete("/api/reviews/:id", async (req, res) => {
            try {
                const id = req.params.id;

                // MongoDB ObjectId ভ্যালিডেশন এবং ফরম্যাটিং
                const { ObjectId } = require('mongodb');
                const query = { _id: new ObjectId(id) };

                const result = await reviewsCollection.deleteOne(query);

                if (result.deletedCount === 1) {
                    res.status(200).json({ success: true, message: "Review deleted successfully!" });
                } else {
                    res.status(404).json({ success: false, message: "Review not found!" });
                }
            } catch (err) {
                console.error("Review DELETE error:", err);
                res.status(500).json({ success: false, message: "Server error while deleting review." });
            }
        });


        // ================= ❤️ USER WISHLIST API ROUTES =================

        // ১. নির্দিষ্ট ইউজারের উইশলিস্টের সব বই পাওয়ার রুট
        app.get("/api/user-wishlist", async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) {
                    return res.status(400).json({ success: false, message: "User email is required!" });
                }

                // 🚀 আপনার প্রোভাইড করা কালেকশনের সঠিক নাম ব্যবহার করা হলো
                const result = await wishlistsCollection
                    .find({ userEmail: email })
                    .sort({ createdAt: -1 }) // লেটেস্ট অ্যাড হওয়া বই আগে দেখাবে
                    .toArray();

                res.status(200).json({
                    success: true,
                    message: "Wishlist fetched successfully",
                    data: result
                });
            } catch (err) {
                console.error("User wishlist GET error:", err);
                res.status(500).json({ success: false, message: "Failed to load wishlist items." });
            }
        });

        // ================= ❤️ ADD TO WISHLIST POST API =================
        app.post("/api/wishlist", async (req, res) => {
            try {
                const wishlistData = req.body;

                // ১. প্রয়োজনীয় ডেটা রিসিভ হয়েছে কিনা ভ্যালিডেশন করা
                if (!wishlistData.userEmail || !wishlistData.bookId) {
                    return res.status(400).json({ success: false, message: "Missing required fields!" });
                }

                // ২. একই বই এই ইউজার অলরেডি উইশলিস্টে রেখেছে কিনা চেক করা
                const isExist = await wishlistsCollection.findOne({
                    userEmail: wishlistData.userEmail,
                    bookId: wishlistData.bookId
                });

                if (isExist) {
                    return res.status(400).json({
                        success: false,
                        message: "This book is already in your wishlist!"
                    });
                }

                // ৩. নতুন উইশলিস্ট আইটেম ডাটাবেজে ইনসার্ট করা
                const result = await wishlistsCollection.insertOne(wishlistData);

                res.status(201).json({
                    success: true,
                    message: "Book added to wishlist successfully!",
                    insertedId: result.insertedId
                });

            } catch (err) {
                console.error("Wishlist POST error:", err);
                res.status(500).json({ success: false, message: "Internal server error." });
            }
        });

        // ২. উইশলিস্ট থেকে নির্দিষ্ট আইটেম ডিলিট করার রুট
        app.delete("/api/wishlist/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { ObjectId } = require('mongodb');

                // 🚀 ডিলিট অপারেশনেও সঠিক কালেকশন ভ্যারিয়েবল ম্যাপ করা হলো
                const query = { _id: new ObjectId(id) };
                const result = await wishlistsCollection.deleteOne(query);

                if (result.deletedCount === 1) {
                    res.status(200).json({ success: true, message: "Removed from wishlist successfully!" });
                } else {
                    res.status(404).json({ success: false, message: "Item not found in wishlist!" });
                }
            } catch (err) {
                console.error("Wishlist item DELETE error:", err);
                res.status(500).json({ success: false, message: "Server error while removing from wishlist." });
            }
        });

        // ================== LIBRARIAN ADD BOOK ==================

        app.post("/librarian/addbook", verifyToken, async (req, res) => {
            try {
                const bookData = req.body;

                if (!bookData.title || !bookData.author || !bookData.deliveryFee) {
                    return res.status(400).json({ success: false, message: "প্রয়োজনীয় তথ্যগুলো প্রদান করুন।" });
                }

                const librarianName = bookData.librarian || "Unknown Librarian";

                const newBookDoc = {
                    title: bookData.title,
                    author: bookData.author,
                    description: bookData.description,
                    category: bookData.category,
                    deliveryFee: parseFloat(bookData.deliveryFee),
                    image: bookData.image || "default-link",
                    librarian: librarianName,
                    librarianEmail: bookData.librarianEmail || "",
                    status: "Pending Approval",
                    createdAt: new Date()
                };

                const result = await booksCollection.insertOne(newBookDoc);

                res.status(201).json({
                    success: true,
                    message: "বইটি সফলভাবে যুক্ত হয়েছে এবং অ্যাডমিন অনুমোদনের অপেক্ষায় আছে।",
                    result
                });
            } catch (error) {
                console.log('Add book error:', error);
                res.status(500).json({ success: false, message: "অভ্যন্তরীণ সার্ভার ত্রুটি!" });
            }
        });

        // ================= 👑 ADMIN TRANSACTIONS ROUTE (নতুন যোগ করুন) =================
        app.get("/api/admin/transactions", async (req, res) => {
            try {
                // ডাটাবেজের সব ডেলিভারি/লেনদেন একেবারে লেটেস্ট ডেট অনুযায়ী নিয়ে আসা
                const deliveries = await deliveriesCollection.find().sort({ createdAt: -1 }).toArray();

                // ফ্রন্টএন্ড টেবিলের ফরম্যাটের সাথে মিলানোর জন্য ডেটা ম্যাপ করা
                const formattedTransactions = deliveries.map(item => ({
                    id: item._id,
                    transactionId: item.sessionId || `TXN-${item._id.toString().substring(0, 10).toUpperCase()}`,
                    userName: item.userName || "Regular User",
                    userEmail: item.userEmail || "No Email",
                    librarianName: item.librarianName || "Main Library",
                    librarianEmail: item.librarianEmail || "library@readhaus.com",
                    bookTitle: item.bookTitle || "Purchased Book",
                    amount: Number(item.price) || 0, // ব্যাকএন্ডের price ফ্রন্টএন্ডে amount হিসেবে যাবে
                    date: item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                    }) : "Recent",
                    status: item.status || "Pending"
                }));

                res.status(200).json({
                    success: true,
                    data: formattedTransactions
                });
            } catch (err) {
                console.error("Fetch transactions error:", err);
                res.status(500).json({ success: false, error: "লেনদেনের তালিকা লোড করতে ব্যর্থ হয়েছে।" });
            }
        });
        // ================= 📊 ADMIN DASHBOARD STATS ================= 

        app.get("/api/admin/dashboard-stats", async (req, res) => {
            try {
                const totalUsers = await usersCollection.countDocuments();
                const totalBooks = await booksCollection.countDocuments();
                const totalDeliveries = await deliveriesCollection.countDocuments();

                const deliveries = await deliveriesCollection.find().toArray();
                const totalRevenue = deliveries.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

                const categoryData = await booksCollection.aggregate([
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
                console.error("Dashboard stats error:", err);
                res.status(500).json({ error: "Failed to fetch dashboard stats" });
            }
        });

        // ================= 👑 ADMIN BOOK APPROVALS API =================

        app.get("/api/admin/book-approvals", async (req, res) => {
            try {
                const pendingBooks = await booksCollection
                    .find({ status: "Pending Approval" })
                    .sort({ createdAt: -1 })
                    .toArray();
                res.json(pendingBooks);
            } catch (err) {
                res.status(500).json({ error: "পেন্ডিং বইগুলো লোড করতে ব্যর্থ হয়েছে।" });
            }
        });

        app.patch("/api/admin/book-approve/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await booksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "Published" } }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).json({ error: "বইটি পাওয়া যায়নি অথবা ইতিমধ্যে অনুমোদিত হয়েছে।" });
                }
                res.json({ success: true, message: "বইটি সফলভাবে পাবলিশ (অনুমোদন) করা হয়েছে!" });
            } catch (err) {
                res.status(500).json({ error: "বই অনুমোদনের সময় সার্ভারে সমস্যা হয়েছে।" });
            }
        });

        app.delete("/api/admin/book-reject/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: "বইটি পাওয়া যায়নি।" });
                }
                res.json({ success: true, message: "বইটি বাতিল এবং ডিলিট করা হয়েছে।" });
            } catch (err) {
                res.status(500).json({ error: "বইটি ডিলিট করতে ব্যর্থ হয়েছে।" });
            }
        });

        app.patch("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;
                const result = await booksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: "Book not found" });
                }
                res.json({ success: true, message: "Book updated successfully" });
            } catch (err) {
                res.status(500).json({ error: "Failed to update book" });
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
                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: "User not found" });
                }
                res.json({ success: true, message: "User deleted successfully" });
            } catch (err) {
                res.status(500).json({ error: "Failed to delete user" });
            }
        });

        app.patch("/api/admin/user-role/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { role } = req.body;
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role: role } }
                );
                res.json({ success: true, message: "Role updated" });
            } catch (err) {
                res.status(500).json({ error: "Failed to update role" });
            }
        });


        // ================= 📚 LIBRARIAN OVERVIEW STATS API =================
        app.get("/api/librarian-stats", async (req, res) => {
            try {
                const { email } = req.query;

                if (!email) {
                    return res.status(400).json({ success: false, message: "Email is required" });
                }

                const totalBooks = await booksCollection.countDocuments({ librarianEmail: email });
                const librarianBooks = await booksCollection.find({ librarianEmail: email }).toArray();
                const bookIds = librarianBooks.map(book => book._id.toString());

                const deliveries = await deliveriesCollection.find({
                    bookId: { $in: bookIds },
                    status: "complete"
                }).toArray();

                const totalEarnings = deliveries.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

                const pendingRequests = await booksCollection.countDocuments({
                    librarianEmail: email,
                    status: "Pending Approval"
                });

                const categoryDistribution = await booksCollection.aggregate([
                    { $match: { librarianEmail: email } },
                    { $group: { _id: "$category", count: { $sum: 1 } } },
                    { $project: { name: "$_id", value: "$count", _id: 0 } }
                ]).toArray();

                res.status(200).json({
                    success: true,
                    data: {
                        totalBooks,
                        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
                        pendingRequests,
                        categoryDistribution: categoryDistribution.length > 0 ? categoryDistribution : []
                    }
                });
            } catch (err) {
                console.error("Librarian stats error:", err);
                res.status(500).json({ success: false, message: "Failed to fetch librarian stats" });
            }
        });

        // ================= 🚚 DELIVERIES COLLECTION =================

        app.post('/api/deliveries', async (req, res) => {
            const data = req.body;
            await deliveriesCollection.insertOne({ ...data, createdAt: new Date() });
            res.json({ success: true });
        });

        app.patch('/api/deliveries/update-status', async (req, res) => {
            const { sessionId, status } = req.body;
            const result = await deliveriesCollection.updateOne(
                { sessionId: sessionId },
                { $set: { status: status } }
            );
            res.json({ success: true, modifiedCount: result.modifiedCount });
        });


        // ================= 📚 BOOKS COLLECTION =================

        app.get("/api/books", async (req, res) => {
            try {
                const { search, category, minFee, maxFee, availability, page = 1, limit = 10 } = req.query;
                let query = {};

                query.status = "Published"; // ডিফল্টভাবে শুধুমাত্র অ্যাপ্রুভড বই দেখাবে

                if (search) {
                    query.title = { $regex: search, $options: 'i' };
                }

                if (category && category !== "All") {
                    query.category = category;
                }

                if (minFee || maxFee) {
                    query.deliveryFee = {};
                    if (minFee) query.deliveryFee.$gte = Number(minFee);
                    if (maxFee) query.deliveryFee.$lte = Number(maxFee);
                }

                if (availability && availability !== "All") {
                    query.availability = availability;
                }

                const pageNumber = parseInt(page);
                const limitNumber = parseInt(limit);
                const skip = (pageNumber - 1) * limitNumber;

                const totalBooks = await booksCollection.countDocuments(query);
                const books = await booksCollection.find(query).skip(skip).limit(limitNumber).toArray();

                res.json({
                    success: true,
                    totalBooks,
                    totalPages: Math.ceil(totalBooks / limitNumber),
                    currentPage: pageNumber,
                    data: books
                });
            } catch (err) {
                console.error("Browse books error:", err);
                res.status(500).json({ error: "বইগুলো লোড করতে বা ফিল্টার করতে ব্যর্থ হয়েছে।" });
            }
        });

        app.get("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { email } = req.query;

                const book = await booksCollection.findOne({ _id: new ObjectId(id) });
                if (!book) {
                    return res.status(404).json({ error: "Book not found" });
                }

                let isPurchased = false;
                if (email) {
                    const purchaseCheck = await deliveriesCollection.findOne({
                        bookId: id,
                        userEmail: email,
                        status: "complete"
                    });
                    if (purchaseCheck) {
                        isPurchased = true;
                    }
                }

                const bookReviews = await reviewsCollection.find({ bookId: new ObjectId(id) }).sort({ dateAdded: -1 }).toArray();

                book.reviews = bookReviews;
                book.isPurchased = isPurchased;

                res.json(book);
            } catch (err) {
                res.status(500).json({ error: "Invalid ID or server error" });
            }
        });

        app.post("/api/books", async (req, res) => {
            try {
                const newBook = req.body;
                const result = await booksCollection.insertOne(newBook);
                res.json({
                    success: true,
                    message: "Book added successfully",
                    insertedId: result.insertedId,
                });
            } catch (err) {
                res.status(500).json({ error: "Failed to add book" });
            }
        });

        app.put("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;
                const result = await booksCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
                res.json({
                    success: true,
                    message: "Book updated successfully",
                    result,
                });
            } catch (err) {
                res.status(500).json({ error: "Failed to update book" });
            }
        });

        app.delete("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });
                res.json({
                    success: true,
                    message: "Book deleted successfully",
                    result,
                });
            } catch (err) {
                res.status(500).json({ error: "Failed to delete book" });
            }
        });


        // ================= ⭐ REVIEWS COLLECTION =================

        app.post("/api/reviews", async (req, res) => {
            try {
                const { bookId, userName, userEmail, userImage, rating, reviewText } = req.body;

                const hasReceivedBook = await deliveriesCollection.findOne({
                    bookId: bookId,
                    userEmail: userEmail,
                    status: "complete"
                });

                if (!hasReceivedBook) {
                    return res.status(403).json({
                        success: false,
                        message: "দুঃখিত! শুধুমাত্র বইটি সফলভাবে ডেলিভারি পাওয়ার পরেই আপনি রিভিউ দিতে পারবেন।"
                    });
                }

                const newReview = {
                    bookId: new ObjectId(bookId),
                    userName,
                    userEmail,
                    userImage: userImage || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde",
                    rating: Number(rating),
                    reviewText,
                    dateAdded: new Date()
                };

                const reviewResult = await reviewsCollection.insertOne(newReview);

                const stats = await reviewsCollection.aggregate([
                    { $match: { bookId: new ObjectId(bookId) } },
                    {
                        $group: {
                            _id: "$bookId",
                            totalReviews: { $sum: 1 },
                            averageRating: { $avg: "$rating" }
                        }
                    }
                ]).toArray();

                if (stats.length > 0) {
                    const { totalReviews, averageRating } = stats[0];
                    await booksCollection.updateOne(
                        { _id: new ObjectId(bookId) },
                        {
                            $set: {
                                totalReviews,
                                averageRating: parseFloat(averageRating.toFixed(1))
                            }
                        }
                    );
                }

                res.json({ success: true, message: "আপনার ভেরিফাইড রিভিউটি সফলভাবে যুক্ত হয়েছে!", reviewId: reviewResult.insertedId });
            } catch (err) {
                res.status(500).json({ error: "রিভিউ যুক্ত করতে ব্যর্থ হয়েছে", details: err.message });
            }
        });

        app.get("/api/reviews/:bookId", async (req, res) => {
            try {
                const bookId = req.params.bookId;
                const reviews = await reviewsCollection.find({ bookId: new ObjectId(bookId) }).sort({ dateAdded: -1 }).toArray();
                res.json(reviews);
            } catch (err) {
                res.status(500).json({ error: "Failed to fetch reviews" });
            }
        });

        // 🚀 ডেটাবেজ কানেক্ট হওয়ার পর এখন সার্ভার লিসেন করবে নিরাপদে!
        console.log("MongoDB connected successfully!");

        app.get("/", (req, res) => {
            res.send("Server is running fine!");
        });

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

    } catch (err) {
        console.error("MongoDB connection error:", err);
    }
}

run().catch(console.dir);