// const dns = require('node:dns');
// dns.setServers(['1.1.1.1', '1.0.0.1']);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const uri = process.env.MONGODB_URI;
const app = express();
const PORT = process.env.PORT || 5000;

app.use(
    cors({
        credentials: true,
        origin: [process.env.CLIENT_URL || "http://localhost:3000"],
    })
);

app.use(express.json());

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
        const usersCollection = db.collection("users");
        const booksCollection = db.collection("books");
        const reviewsCollection = db.collection("reviews");
        const deliveriesCollection = db.collection("deliveries");
        const addBooksCollection = db.collection("addbooks");



        // ================== laibrarian add book ==================

        app.post("/librarian/addbook", async (req, res) => {
            try {
                const bookData = req.body;
                const librarianName = req.user.name;

                const newBookDoc = {
                    title: bookData.title,
                    author: bookData.author,
                    description: bookData.description,
                    category: bookData.category,
                    deliveryFee: parseFloat(bookData.deliveryFee),
                    image: bookData.image || "default-link",
                    librarian: librarianName, // 👈 স্বয়ংক্রিয়ভাবে বসে গেল
                    status: "pending",
                    createdAt: new Date()
                };

                const result = await addBooksCollection.insertOne(newBookDoc);
                res.status(201).json({ success: true, result });
            } catch (error) {
                console.log('Main error', error);
                res.status(500).json({ success: false });

            }

        });


        // ================= 👑 ADMIN BOOK APPROVALS API =================

        // ১. শুধুমাত্র 'pending' (অনুমোদনহীন) বইগুলো এডমিন প্যানেলে দেখানোর জন্য গেট এপিআই
        app.get("/api/admin/book-approvals", async (req, res) => {
            try {
                const pendingBooks = await booksCollection
                    .find({ status: "pending" })
                    .sort({ createdAt: -1 })
                    .toArray();
                res.json(pendingBooks);
            } catch (err) {
                res.status(500).json({ error: "অনুমোদনহীন বইয়ের তালিকা আনতে ব্যর্থ হয়েছে" });
            }
        });

        // ২. বই Approve করার এপিআই (স্ট্যাটাস 'available' হয়ে যাবে যেন ইউজাররা ব্রাউজ পেজে দেখতে পায়)
        app.patch("/api/admin/book-approve/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await booksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "available" } } // 'pending' থেকে 'available' এ পরিবর্তন
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).json({ error: "বইটি খুঁজে পাওয়া যায়নি বা ইতিমধ্যে অনুমোদিত" });
                }
                res.json({ success: true, message: "বইটি সফলভাবে অনুমোদন করা হয়েছে" });
            } catch (err) {
                res.status(500).json({ error: "বই অনুমোদন করতে সার্ভার সমস্যা হয়েছে" });
            }
        });

        // ৩. বই রিজেক্ট বা ডাটাবেজ থেকে পুরোপুরি ডিলিট করার এপিআই
        app.delete("/api/admin/book-reject/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: "বইটি খুঁজে পাওয়া যায়নি" });
                }
                res.json({ success: true, message: "বইটি ডাটাবেজ থেকে পুরোপুরি মুছে ফেলা হয়েছে" });
            } catch (err) {
                res.status(500).json({ error: "বইটি ডিলিট করতে সমস্যা হয়েছে" });
            }
        });


        // ================= 🚚 DELIVERIES COLLECTION (Payment & Order) =================

        // ১. পোস্ট ডেলিভারি (পেমেন্ট সফল হলে)
        app.post('/api/deliveries', async (req, res) => {
            try {
                const { status, userId, sessionId, userEmail, price, bookId, bookTitle } = req.body;
                const isExites = await deliveriesCollection.findOne({ sessionId });
                if (isExites) {
                    return res.json({ mes: "already exites" });
                }
                await deliveriesCollection.insertOne({
                    status: (status === "complete" || !status) ? "pending" : status,
                    userEmail,
                    userId,
                    sessionId,
                    price,
                    bookId,
                    bookTitle,
                    createdAt: new Date()
                });
                res.json({ mes: 'Payments successfull' });
            } catch (err) {
                res.status(500).json({ error: "Failed to process delivery" });
            }
        });


        // ================= 📚 BOOKS COLLECTION (Search, Filter, CRUD) =================

        // ১. সব বই গেট করা (অ্যাডভান্সড সার্চ, ফিল্টার এবং পেজিনেশন সহ)
        app.get("/api/books", async (req, res) => {
            try {
                const { search, category, minFee, maxFee, availability, page = 1, limit = 6 } = req.query;
                let query = {};
                query.status = { $in: ["available", "checked out"] };

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
                    query.status = availability.toLowerCase();
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
                res.status(500).json({ error: "Failed to fetch books or evaluate filters" });
            }
        });

        // ২. একটি নির্দিষ্ট বই গেট করা (রিভিউ এবং পারচেজ চেক সহ)
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
                        bookId: new ObjectId(id),
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

        // ৩. নতুন বই যোগ করা (Add Book)
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

        // ৪. বইয়ের ডাটা আপডেট করা (Update Book)
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

        // ৫. বই ডিলিট করা (Delete Book)
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


        // ================= ⭐ REVIEWS COLLECTION (Review Post & Live Average) =================

        // ১. নতুন রিভিউ পোস্ট করা (এবং অটোমেটিকভাবে বইয়ের এভারেজ রেটিং আপডেট করা)
        app.post("/api/reviews", async (req, res) => {
            try {
                const { bookId, userName, userEmail, userImage, rating, reviewText } = req.body;

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

                res.json({ success: true, message: "Review added successfully!", reviewId: reviewResult.insertedId });
            } catch (err) {
                res.status(500).json({ error: "Failed to add review", details: err.message });
            }
        });

        // ২. কোনো নির্দিষ্ট বইয়ের সব রিভিউ দেখা
        app.get("/api/reviews/:bookId", async (req, res) => {
            try {
                const bookId = req.params.bookId;
                const reviews = await reviewsCollection.find({ bookId: new ObjectId(bookId) }).sort({ dateAdded: -1 }).toArray();
                res.json(reviews);
            } catch (err) {
                res.status(500).json({ error: "Failed to fetch reviews" });
            }
        });


        // ================= 📊 ADMIN DASHBOARD OVERVIEW DATA (রিয়েল ডাটাবেজ ক্যালকুলেশন) =================

        // আপনার ড্যাশবোর্ডের ৪টি কার্ড ও ডোনাট চার্টের জন্য একদম রিয়েল-টাইম ডাটা এন্ডপয়েন্ট
        app.get("/api/admin/dashboard-stats", async (req, res) => {
            try {
                // ১. ডাইনামিক কাউন্ট জেনারেট করা
                const totalUsers = await usersCollection.countDocuments();
                const totalBooks = await booksCollection.countDocuments();
                const totalDeliveries = await deliveriesCollection.countDocuments({ status: "pending" }); // অথবা "complete" আপনার লজিক অনুযায়ী

                // ২. টোটাল রাজস্ব (Revenue) হিসেব করা
                const allDeliveries = await deliveriesCollection.find().toArray();
                const totalRevenue = allDeliveries.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

                // ৩. হাফ-পাই চার্টের জন্য ক্যাটাগরি ভিত্তিক বইয়ের পরিমাণ বের করা (MongoDB Aggregation)
                const categoryStats = await booksCollection.aggregate([
                    { $group: { _id: "$category", value: { $sum: 1 } } },
                    { $project: { name: "$_id", value: 1, _id: 0 } }
                ]).toArray();

                // ৪. ফ্রন্টএন্ডের জন্য রেসপন্স পাঠানো
                res.json({
                    success: true,
                    totalUsers,
                    totalBooks,
                    totalDeliveries,
                    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
                    chartData: categoryStats.length > 0 ? categoryStats : [{ name: "No Books", value: 0 }]
                });
            } catch (err) {
                res.status(500).json({ error: "Failed to fetch dashboard live metrics" });
            }
        });


        console.log("MongoDB connected successfully!");
    } catch (err) {
        console.error("MongoDB connection error:", err);
    }
}

run().catch(console.dir);

// Home route
app.get("/", (req, res) => {
    res.send("Server is running fine!");
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});