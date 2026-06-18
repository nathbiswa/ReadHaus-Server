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

        // ================= GET ALL BOOKS =================
        app.get("/api/books", async (req, res) => {
            try {
                const books = await booksCollection.find().toArray();
                res.json(books);
            } catch (err) {
                res.status(500).json({ error: "Failed to fetch books" });
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