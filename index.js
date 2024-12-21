import baileys from "@whiskeysockets/baileys";
import useMongoDBAuthState from "./modules/mongoAuth.js";
import { MongoClient } from "mongodb";
import { pino } from "pino";
import 'dotenv/config'
// Constants for baileys
const { DisconnectReason } = baileys;
const makeWASocket = baileys.default;

// MongoDB connection URL
const mongoURL = process.env.mongo_url;

// MongoDB Connection Logic
const connectionLogic = async () => {
    try {
        // Connect to MongoDB
        console.log("Connecting to MongoDB...");
        const mongoClient = await new MongoClient(mongoURL, {
            ssl: true,
            tls: true,
            tlsAllowInvalidCertificates: false,
        }).connect();

        console.log("Connected to MongoDB");

        // Use MongoDB Auth State
        const { state, saveCreds } = await useMongoDBAuthState(
            mongoClient.db("whatsapp_api").collection("auth_info_baileys")
        );

        // Make WhatsApp socket connection
        const sock = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Shiroko', 'Chrome', '1.0.0'],
        });

        // Handle connection updates (QR code, reconnect, etc.)
        sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                console.log("QR Code received:", qr);  // Show QR code
            }

            if (connection === "close") {
                console.log("Connection closed due to:", lastDisconnect?.error?.output?.statusCode);
                // If not logged out, reconnect
                if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                    console.log("Reconnecting...");
                    connectionLogic();  // Reconnect
                }
            }
        });

        // Handle new or incoming messages
        sock.ev.on("messages.upsert", async (messages) => {
            if(!messages.messages[0]) return 0
            console.log(messages.messages[0])
        });

        // Handle credentials updates (save them in MongoDB)
        sock.ev.on("creds.update", saveCreds);
    } catch (error) {
        console.error("Error in connection logic:", error.message || error);
    }
};

// Start the connection logic
connectionLogic();