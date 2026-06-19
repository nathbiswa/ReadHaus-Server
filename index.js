// const dns = require('node:dns');
// dns.setServers(['1.1.1.1', '1.0.0.1']);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(
    cors({
        credentials: true,
        origin: [process.env.CLIENT_URL],
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

        // Collections
        const usersCollection = db.collection("users");
        const booksCollection = db.collection("books");
        const reviewsCollection = db.collection("reviews");
        const deliveriesCollection = db.collection("deliveries");

        // ================= GET ALL BOOKS (WITH ADVANCED SEARCH, FILTER & PAGINATION) =================
        app.get("/api/books", async (req, res) => {
            try {
                // ফ্রন্টএন্ড থেকে কুয়েরি প্যারামিটারগুলো রিসিভ করা হচ্ছে
                const { search, category, minFee, maxFee, availability, page = 1, limit = 6 } = req.query;

                // ১. ডাইনামিক কুয়েরি অবজেক্ট তৈরি
                let query = {};

                // কন্ডিশন: সাধারণ ইউজাররা শুধু Published অথবা Checked Out বই দেখতে পারবে (Admin/Librarian এর অনুমোদন ছাড়া Pending বইগুলো এখানে আসবে না)
                query.status = { $in: ["Published", "Checked Out"] };

                // রিকোয়ারমেন্ট: Searching বাই Name (বইয়ের নাম/টাইটেল দিয়ে সার্চ - Case Insensitive)
                if (search) {
                    query.title = { $regex: search, $options: 'i' };
                }

                // রিকোয়ারমেন্ট: Filtering বাই Category
                if (category && category !== "All") {
                    query.category = category;
                }

                // রিকোয়ারমেন্ট: Filtering বাই Delivery Fee Range
                if (minFee || maxFee) {
                    query.deliveryFee = {};
                    if (minFee) query.deliveryFee.$gte = Number(minFee);
                    if (maxFee) query.deliveryFee.$lte = Number(maxFee);
                }

                // রিকোয়ারমেন্ট: Filtering বাই Availability Status (Published = Available, Checked Out = Unavailable)
                if (availability && availability !== "All") {
                    query.status = availability;
                }

                // ২. সার্ভার-সাইড পেহিনেশন লজিক
                const pageNumber = parseInt(page);
                const limitNumber = parseInt(limit);
                const skip = (pageNumber - 1) * limitNumber;

                // ফিল্টার অনুযায়ী মোট কতটি বই আছে তা বের করা (যাতে ফ্রন্টএন্ডে টোটাল পেজ সংখ্যা দেখানো যায়)
                const totalBooks = await booksCollection.countDocuments(query);

                // ডাটাবেজ থেকে নির্দিষ্ট লিমিট এবং স্কিপ অনুযায়ী ডাটা তুলে আনা
                const books = await booksCollection.find(query)
                    .skip(skip)
                    .limit(limitNumber)
                    .toArray();

                // ফ্রন্টএন্ডের সুবিধার জন্য মেটা-ডাটা সহ রেসপন্স পাঠানো
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

        // ================= GET SINGLE BOOK =================
        app.get("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;

                const book = await booksCollection.findOne({
                    _id: new ObjectId(id),
                });

                if (!book) {
                    return res.status(404).json({ error: "Book not found" });
                }

                res.json(book);
            } catch (err) {
                res.status(500).json({ error: "Invalid ID or server error" });
            }
        });

        // ================= ADD BOOK =================
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

        // ================= UPDATE BOOK =================
        app.put("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;

                const result = await booksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );

                res.json({
                    success: true,
                    message: "Book updated successfully",
                    result,
                });
            } catch (err) {
                res.status(500).json({ error: "Failed to update book" });
            }
        });

        // ================= DELETE BOOK =================
        app.delete("/api/books/:id", async (req, res) => {
            try {
                const id = req.params.id;

                const result = await booksCollection.deleteOne({
                    _id: new ObjectId(id),
                });

                res.json({
                    success: true,
                    message: "Book deleted successfully",
                    result,
                });
            } catch (err) {
                res.status(500).json({ error: "Failed to delete book" });
            }
        });

        console.log("MongoDB connected successfully!");
    } finally {
        // keep connection open
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