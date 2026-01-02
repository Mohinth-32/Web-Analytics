import dotenv from "dotenv";
dotenv.config(); // ✅ MUST be first
import fs from "fs";

import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: {
    ca: fs.readFileSync("./ca.pem")
  },
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0
});

const app = express();
app.use(cors());
app.use(express.json());

/* Health check */
app.get("/", (req, res) => {
  res.json({ message: "Tracking server running" });
});

/* Tracking endpoint */
app.post("/track", async (req, res) => {
  try {
    console.log("Content-Type:", req.headers["content-type"]);
    console.log("Body:", req.body);
    
    const { site, page, referrer, userAgent, screen } = req.body;

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress;

    await db.execute(
      `INSERT INTO site_visits
       (site, page, referrer, user_agent, ip_address, screen)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [site, page, referrer, userAgent, ip, screen]
    );

    res.status(200).json({ message: "Tracked" });
  } catch (err) {
    console.error("TRACK ERROR:", err);
    res.status(500).json({ message: "Tracking failed" });
  }
});

/* Analytics endpoints */
// Get visits over time (grouped by day)
app.get("/analytics/visits-over-time", async (req, res) => {
  try {
    const { site, days = 30 } = req.query;
    
    let query = `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as visits
      FROM site_visits
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [parseInt(days)];
    
    if (site) {
      query += ` AND site = ?`;
      params.push(site);
    }
    
    query += ` GROUP BY DATE(created_at) ORDER BY date ASC`;
    
    const [rows] = await db.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

// Get visits by site
app.get("/analytics/by-site", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const [rows] = await db.execute(
      `SELECT 
        site,
        COUNT(*) as visits
      FROM site_visits
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY site`,
      [parseInt(days)]
    );
    
    res.json(rows);
  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

// Get top pages
app.get("/analytics/top-pages", async (req, res) => {
  try {
    const { site, days = 30, limit = 10 } = req.query;
    
    let query = `
      SELECT 
        page,
        COUNT(*) as visits
      FROM site_visits
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [parseInt(days)];
    
    if (site) {
      query += ` AND site = ?`;
      params.push(site);
    }
    
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 10), 1000);
    query += ` GROUP BY page ORDER BY visits DESC LIMIT ${safeLimit}`;
    
    const [rows] = await db.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

// Get all visits (with pagination and filters)
app.get("/analytics/visits", async (req, res) => {
  try {
    const { site, page, days = 30, limit = 100, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        id, site, page, referrer, user_agent, ip_address, screen, created_at
      FROM site_visits
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [parseInt(days)];
    
    if (site) {
      query += ` AND site = ?`;
      params.push(site);
    }
    
    if (page) {
      query += ` AND page = ?`;
      params.push(page);
    }
    
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 100), 1000);
    const safeOffset = Math.max(0, parseInt(offset) || 0);
    query += ` ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;
    
    const [rows] = await db.execute(query, params);
    res.json(rows);
  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

// Get summary stats
app.get("/analytics/summary", async (req, res) => {
  try {
    const { site, days = 30 } = req.query;
    
    let query = `
      SELECT 
        COUNT(*) as total_visits,
        COUNT(DISTINCT site) as total_sites,
        COUNT(DISTINCT page) as total_pages,
        COUNT(DISTINCT ip_address) as unique_visitors
      FROM site_visits
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const params = [parseInt(days)];
    
    if (site) {
      query += ` AND site = ?`;
      params.push(site);
    }
    
    const [rows] = await db.execute(query, params);
    res.json(rows[0]);
  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

const PORT =  3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
process.on("uncaughtException", err => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", err => {
  console.error("UNHANDLED REJECTION:", err);
});
