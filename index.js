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

// ✅ Only one strict CORS configuration
app.use(
    cors({
        credentials: true,
        origin: [process.env.CLIENT_URL || "http://localhost:3000"],
    })
);

app.use(express.json());

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
        const usersCollection = db.collection("users");
        const booksCollection = db.collection("books");
        const reviewsCollection = db.collection("reviews");
        const deliveriesCollection = db.collection("deliveries");
        const addBooksCollection = db.collection("addbooks");
        const wishlistsCollection = db.collection("wishlists"); // ✅ Standardized collection name

        // ================= ❤️ WISHLIST COLLECTION =================

        // 1. Add a new book to wishlist (POST)
        app.post("/api/wishlist", async (req, res) => {
            try {
                const wishlistData = req.body;

                // Duplicate Check to prevent multiple entries of the same book
                const isAlreadyAdded = await wishlistsCollection.findOne({
                    userEmail: wishlistData.userEmail,
                    bookId: wishlistData.bookId
                });

                if (isAlreadyAdded) {
                    return res.status(400).json({ success: false, message: "This book is already in your wishlist!" });
                }

                // Insert into database
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

        // 3. Fetch analytics data for the user overview dashboard screen (GET)
        app.get("/api/user-summary", async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).json({ success: false, message: "User email is required!" });
                }

                // Async aggregate tracking using the deliveries collection
                const booksReadCount = await deliveriesCollection.countDocuments({ userEmail: email, status: "read" });
                const pendingCount = await deliveriesCollection.countDocuments({ userEmail: email, status: "pending" });

                // Fetching all spending events for this client
                const userDeliveries = await deliveriesCollection.find({ userEmail: email }).toArray();
                const totalSpent = userDeliveries.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

                res.status(200).json({
                    success: true,
                    message: "User dashboard activities summary fetched successfully",
                    data: {
                        booksRead: booksReadCount || 0,
                        pendingDeliveries: pendingCount || 0,
                        totalSpent: parseFloat(totalSpent.toFixed(2))
                    }
                });
            } catch (err) {
                console.error("User summary GET error:", err);
                res.status(500).json({ success: false, message: "Internal server error! Failed to fetch activity summary." });
            }
        });


        // ================== librarian add book ==================

        app.post("/librarian/addbook", verifyToken, async (req, res) => {
            try {
                const bookData = req.body;
                const librarianName = bookData.librarian || "Unknown Librarian";

                const newBookDoc = {
                    title: bookData.title,
                    author: bookData.author,
                    description: bookData.description,
                    category: bookData.category,
                    deliveryFee: parseFloat(bookData.deliveryFee),
                    image: bookData.image || "default-link",
                    librarian: librarianName,
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

        app.get("/api/admin/book-approvals", async (req, res) => {
            try {
                const pendingBooks = await booksCollection
                    .find({ status: "pending" })
                    .sort({ createdAt: -1 })
                    .toArray();
                res.json(pendingBooks);
            } catch (err) {
                res.status(500).json({ error: "Failed to fetch pending books." });
            }
        });

        app.patch("/api/admin/book-approve/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await booksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "available" } }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).json({ error: "Book not found or already approved." });
                }
                res.json({ success: true, message: "Book approved successfully!" });
            } catch (err) {
                res.status(500).json({ error: "Server error during book approval." });
            }
        });

        app.delete("/api/admin/book-reject/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: "Book not found." });
                }
                res.json({ success: true, message: "Book rejected and deleted successfully." });
            } catch (err) {
                res.status(500).json({ error: "Failed to delete the book." });
            }
        });


        // ================= 🚚 DELIVERIES COLLECTION (Payment & Order) =================

        app.post('/api/deliveries', async (req, res) => {
            try {
                const { status, userId, sessionId, userEmail, price, bookId, bookTitle } = req.body;
                const isExites = await deliveriesCollection.findOne({ sessionId });
                if (isExites) {
                    return res.json({ mes: "already exists" });
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
                res.json({ mes: 'Payment successful' });
            } catch (err) {
                res.status(500).json({ error: "Failed to process delivery" });
            }
        });


        // ================= 📚 BOOKS COLLECTION (Search, Filter, CRUD) =================

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

        app.get("/api/reviews/:bookId", async (req, res) => {
            try {
                const bookId = req.params.bookId;
                const reviews = await reviewsCollection.find({ bookId: new ObjectId(bookId) }).sort({ dateAdded: -1 }).toArray();
                res.json(reviews);
            } catch (err) {
                res.status(500).json({ error: "Failed to fetch reviews" });
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