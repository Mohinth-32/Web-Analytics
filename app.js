import dotenv from "dotenv";
dotenv.config(); // ✅ MUST be first
import express from "express";
import cors from "cors";
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
const db = postgres(connectionString)


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

    await db`
      INSERT INTO site_visits
      (site, page, referrer, user_agent, ip_address, screen)
      VALUES (${site}, ${page}, ${referrer}, ${userAgent}, ${ip}, ${screen})
    `;

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
    
    const daysInt = parseInt(days);
    
    let rows;
    if (site) {
      rows = await db`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as visits
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        AND site = ${site}
        GROUP BY DATE(created_at) 
        ORDER BY date ASC
      `;
    } else {
      rows = await db`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as visits
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        GROUP BY DATE(created_at) 
        ORDER BY date ASC
      `;
    }
    
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
    
    const daysInt = parseInt(days);
    
    const rows = await db`
      SELECT 
        site,
        COUNT(*) as visits
      FROM site_visits
      WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
      GROUP BY site
    `;
    
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
    
    const daysInt = parseInt(days);
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 10), 1000);
    
    let rows;
    if (site) {
      rows = await db`
        SELECT 
          page,
          COUNT(*) as visits
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        AND site = ${site}
        GROUP BY page 
        ORDER BY visits DESC 
        LIMIT ${safeLimit}
      `;
    } else {
      rows = await db`
        SELECT 
          page,
          COUNT(*) as visits
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        GROUP BY page 
        ORDER BY visits DESC 
        LIMIT ${safeLimit}
      `;
    }
    
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
    
    const daysInt = parseInt(days);
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 100), 1000);
    const safeOffset = Math.max(0, parseInt(offset) || 0);
    
    let rows;
    if (site && page) {
      rows = await db`
        SELECT 
          id, site, page, referrer, user_agent, ip_address, screen, created_at
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        AND site = ${site}
        AND page = ${page}
        ORDER BY created_at DESC 
        LIMIT ${safeLimit} 
        OFFSET ${safeOffset}
      `;
    } else if (site) {
      rows = await db`
        SELECT 
          id, site, page, referrer, user_agent, ip_address, screen, created_at
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        AND site = ${site}
        ORDER BY created_at DESC 
        LIMIT ${safeLimit} 
        OFFSET ${safeOffset}
      `;
    } else if (page) {
      rows = await db`
        SELECT 
          id, site, page, referrer, user_agent, ip_address, screen, created_at
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        AND page = ${page}
        ORDER BY created_at DESC 
        LIMIT ${safeLimit} 
        OFFSET ${safeOffset}
      `;
    } else {
      rows = await db`
        SELECT 
          id, site, page, referrer, user_agent, ip_address, screen, created_at
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        ORDER BY created_at DESC 
        LIMIT ${safeLimit} 
        OFFSET ${safeOffset}
      `;
    }
    
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
    
    const daysInt = parseInt(days);
    
    let rows;
    if (site) {
      rows = await db`
        SELECT 
          COUNT(*) as total_visits,
          COUNT(DISTINCT site) as total_sites,
          COUNT(DISTINCT page) as total_pages,
          COUNT(DISTINCT ip_address) as unique_visitors
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
        AND site = ${site}
      `;
    } else {
      rows = await db`
        SELECT 
          COUNT(*) as total_visits,
          COUNT(DISTINCT site) as total_sites,
          COUNT(DISTINCT page) as total_pages,
          COUNT(DISTINCT ip_address) as unique_visitors
        FROM site_visits
        WHERE created_at >= NOW() - INTERVAL '1 day' * ${daysInt}
      `;
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
process.on("uncaughtException", err => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", err => {
  console.error("UNHANDLED REJECTION:", err);
});
