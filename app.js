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

// Get visits by site as SVG spline chart
app.get("/analytics/by-site/svg", async (req, res) => {
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
    
    // Shuffle the data to create non-linear patterns
    const shuffledRows = [...rows].sort(() => Math.random() - 0.5);
    
    // SVG dimensions
    const width = 900;
    const height = 420;
    const paddingLeft = 70;
    const paddingRight = 60;
    const paddingTop = 60;
    const paddingBottom = 60;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    
    if (shuffledRows.length === 0) {
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <rect width="${width}" height="${height}" fill="#000000"/>
          <text x="${width / 2}" y="${height / 2}" 
                text-anchor="middle" 
                font-family="Arial, sans-serif" 
                font-size="16" 
                fill="#00ff00">
            No data available
          </text>
        </svg>
      `;
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    }
    
    // Calculate max visits for scaling (always start from 0)
    const maxVisits = Math.max(...shuffledRows.map(r => Number(r.visits)));
    const minVisits = 0; // Start from 0
    const range = maxVisits || 1;
    
    // Calculate points for the spline with gap from y-axis
    const gapFromYAxis = 60; // Gap between y-axis and first point
    const effectiveChartWidth = chartWidth - gapFromYAxis;
    
    const points = shuffledRows.map((row, index) => {
      const x = paddingLeft + gapFromYAxis + (index / (shuffledRows.length - 1)) * effectiveChartWidth;
      const normalizedValue = Number(row.visits) / range;
      const y = height - paddingBottom - normalizedValue * chartHeight;
      return { x, y, visits: Number(row.visits), site: row.site };
    });
    
    // Create smooth spline path using cubic bezier curves
    let pathD = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 0; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];
      
      // Calculate control points for smooth curve
      const controlPointX = current.x + (next.x - current.x) / 2;
      
      pathD += ` C ${controlPointX} ${current.y}, ${controlPointX} ${next.y}, ${next.x} ${next.y}`;
    }
    
    // Generate data points and labels
    const dataPoints = points.map(point => `
      <circle cx="${point.x}" cy="${point.y}" r="5" fill="#00ff00" stroke="#000000" stroke-width="2"/>
      <text x="${point.x}" y="${point.y - 15}" 
            text-anchor="middle" 
            font-family="Arial, sans-serif" 
            font-size="12" 
            fill="#00ff00" 
            font-weight="bold">
        ${point.visits}
      </text>
    `).join('');
    
    // Generate X-axis labels
    const xLabels = points.map(point => `
      <text x="${point.x}" 
            y="${height - paddingBottom + 20}" 
            text-anchor="middle" 
            font-family="Arial, sans-serif" 
            font-size="11" 
            font-weight="bold"
            fill="#00ff00"
            transform="rotate(-15, ${point.x}, ${height - paddingBottom + 20})">
        ${point.site}
      </text>
    `).join('');
    
    // Generate Y-axis labels (starting from 0)
    const yAxisSteps = 5;
    const yAxisLabels = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
      const value = Math.round((range / yAxisSteps) * i);
      const y = height - paddingBottom - (chartHeight / yAxisSteps) * i;
      return `
        <text x="${paddingLeft - 10}" 
              y="${y + 5}" 
              text-anchor="end" 
              font-family="Arial, sans-serif" 
              font-size="11" 
              fill="#00ff00">
          ${value}
        </text>
        <line x1="${paddingLeft - 5}" 
              y1="${y}" 
              x2="${paddingLeft}" 
              y2="${y}" 
              stroke="#00ff00" 
              stroke-width="1" 
              opacity="0.3"/>
      `;
    }).join('');
    
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <!-- Background -->
        <rect width="${width}" height="${height}" fill="#000000"/>
        
        <!-- Title -->
        <text x="${width / 2}" 
              y="30" 
              text-anchor="middle" 
              font-family="Arial, sans-serif" 
              font-size="18" 
              font-weight="bold" 
              fill="#6cd66cff">
          Visits by Site (Last ${daysInt} Days)
        </text>
        
        <!-- Y-axis -->
        <line x1="${paddingLeft}" 
              y1="${paddingTop}" 
              x2="${paddingLeft}" 
              y2="${height - paddingBottom}" 
              stroke="#00ff00" 
              stroke-width="2" 
              opacity="0.5"/>
        
        <!-- X-axis -->
        <line x1="${paddingLeft}" 
              y1="${height - paddingBottom}" 
              x2="${width - paddingRight}" 
              y2="${height - paddingBottom}" 
              stroke="#00ff00" 
              stroke-width="2" 
              opacity="0.5"/>
        
        <!-- Y-axis labels -->
        ${yAxisLabels}
        
        <!-- Grid lines -->
        ${Array.from({ length: yAxisSteps + 1 }, (_, i) => {
          const y = height - paddingBottom - (chartHeight / yAxisSteps) * i;
          return `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#00ff00" stroke-width="1" opacity="0.1"/>`;
        }).join('')}
        
        <!-- Spline path -->
        <path d="${pathD}" 
              fill="none" 
              stroke="#00ff00" 
              stroke-width="3" 
              stroke-linecap="round"
              filter="url(#glow)"/>
        
        <!-- Data points -->
        ${dataPoints}
        
        <!-- X-axis labels -->
        ${xLabels}
        
        <!-- Neon glow effect -->
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
      </svg>
    `;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    console.error("SVG CHART ERROR:", err);
    res.status(500).json({ message: "Failed to generate chart" });
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
