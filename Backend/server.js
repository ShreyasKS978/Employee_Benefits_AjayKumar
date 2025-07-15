require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3060;

// PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'postgres',
  database: process.env.DB_NAME || 'new_employee_db',
  password: process.env.DB_PASSWORD || 'admin123',
  port: process.env.DB_PORT || 5432,
});

// Middleware
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    "http://13.203.228.93:3060",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "http://13.203.228.93:8176",
    "http://13.203.228.93:8177"
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        emp_id VARCHAR(50) NOT NULL,
        program VARCHAR(255) NOT NULL,
        program_time VARCHAR(255) NOT NULL,
        request_date DATE NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'Pending'
      );
    `);
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
    process.exit(1);
  }
}
initializeDatabase();

// ========== ROUTES ==========

// ✅ Create a new request
app.post('/api/requests', async (req, res) => {
  try {
    const { name, email, empId, program, time, date } = req.body;

    // Validation
    if (!name || !email || !empId || !program || !time || !date) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check for duplicate request
    const check = await pool.query(
      'SELECT * FROM requests WHERE emp_id = $1 AND program = $2 AND status != $3',
      [empId, program, 'Rejected']
    );

    if (check.rows.length > 0) {
      return res.status(400).json({
        error: `You already have a ${check.rows[0].status.toLowerCase()} request for ${program}`
      });
    }

    // Insert new request
    const result = await pool.query(
      `INSERT INTO requests (
        name, email, emp_id, program, program_time, request_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [name, email, empId, program, time, date, 'Pending']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error creating request:', err);
    res.status(500).json({ error: 'Failed to create request', details: err.message });
  }
});

// ✅ Get all requests
app.get('/api/requests', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM requests ORDER BY request_date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching requests:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// ✅ Get requests by employee ID
app.get('/api/requests/emp/:empId', async (req, res) => {
  try {
    const { empId } = req.params;
    const result = await pool.query('SELECT * FROM requests WHERE emp_id = $1', [empId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No requests found for this employee ID' });
    }

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching employee requests:', err);
    res.status(500).json({ error: 'Failed to fetch employee requests' });
  }
});

// ✅ Update request status
app.put('/api/requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const result = await pool.query(
      'UPDATE requests SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error updating request:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/hr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hr.html'));
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running at http://13.203.228.93:${port}`);
});
