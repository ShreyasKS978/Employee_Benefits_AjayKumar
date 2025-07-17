require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3060;

// PostgreSQL connection with retry logic
const poolConfig = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'postgres',
  database: process.env.DB_NAME || 'new_employee_db',
  password: process.env.DB_PASSWORD || 'admin123',
  port: process.env.DB_PORT || 5432,
  retry: {
    max: 5,
    timeout: 5000
  }
};

const pool = new Pool(poolConfig);

// Test database connection on startup
pool.query('SELECT 1')
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => {
    console.error('Failed to connect to PostgreSQL:', err);
    process.exit(1);
  });

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'Uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (!file) {
      return cb(null, true);
    }
    const filetypes = /pdf|jpg|jpeg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only PDF, JPG, JPEG, and PNG files are allowed'));
  }
});

// Middleware
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    "http://localhost:8176",
    "http://localhost:8177",
    "http://13.201.102.139:8176",
    "http://13.201.102.139:8177",
    "http://frontend:80",
    "http://hr_page:80"
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Create requests table if not exists
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        emp_id VARCHAR(50) NOT NULL,
        program VARCHAR(255) NOT NULL,
        request_date DATE NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'Pending',
        loan_type VARCHAR(100),
        amount NUMERIC,
        reason TEXT,
        document_path VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE OR REPLACE FUNCTION update_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      
      DROP TRIGGER IF EXISTS update_request_timestamp ON requests;
      CREATE TRIGGER update_request_timestamp
      BEFORE UPDATE ON requests
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp();
    `);
    console.log('Database initialized');
  } catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
  }
}

// Initialize the database
initializeDatabase();

// API Routes

// Create a new request
app.post('/api/requests', upload.single('document'), async (req, res) => {
  try {
    const { name, email, empId, program, date, reason, loan_type, amount } = req.body;
    const documentPath = req.file ? `/uploads/${req.file.filename}` : null;

    // Validate required fields
    if (!name || !email || !empId || !program || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check for duplicate request for one-time programs
    const oneTimePrograms = [
      'Yoga and Meditation',
      'Mental Health Support',
      'Awareness Programs',
      'Health Checkup Camps',
      'Gym Membership'
    ];

    if (oneTimePrograms.includes(program)) {
      const check = await pool.query(
        'SELECT * FROM requests WHERE emp_id = $1 AND program = $2 AND status != $3',
        [empId, program, 'Rejected']
      );
      if (check.rows.length) {
        // Delete uploaded file if duplicate request
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          error: `You already have a ${check.rows[0].status.toLowerCase()} request for ${program}`
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO requests (
        name, email, emp_id, program, request_date, status, 
        loan_type, amount, reason, document_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        name, email, empId, program, date, 'Pending',
        loan_type || null, amount || null, reason || null, documentPath
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating request:', err);
    // Delete uploaded file if error occurred
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to create request', details: err.message });
  }
});

// Get all requests (for HR dashboard)
app.get('/api/requests', async (req, res) => {
  try {
    const { status, program } = req.query;
    let query = 'SELECT * FROM requests';
    const params = [];
    
    if (status || program) {
      query += ' WHERE';
      if (status) {
        params.push(status);
        query += ` status = $${params.length}`;
      }
      if (program) {
        if (params.length > 0) query += ' AND';
        params.push(program);
        query += ` program = $${params.length}`;
      }
    }
    
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching requests:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Get requests by employee ID
app.get('/api/requests/emp/:empId', async (req, res) => {
  try {
    const { empId } = req.params;
    const result = await pool.query(
      'SELECT * FROM requests WHERE emp_id = $1 ORDER BY request_date DESC',
      [empId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching employee requests:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Get single request by ID
app.get('/api/requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM requests WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching request:', err);
    res.status(500).json({ error: 'Failed to fetch request' });
  }
});

// Update request status
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
    console.error('Error updating request:', err);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// Delete a request
app.delete('/api/requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // First get the request to check for associated file
    const request = await pool.query(
      'SELECT document_path FROM requests WHERE id = $1',
      [id]
    );
    
    if (request.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    // Delete the request
    await pool.query('DELETE FROM requests WHERE id = $1', [id]);
    
    // Delete associated file if exists
    if (request.rows[0].document_path) {
      const filePath = path.join(
        __dirname, 
        'Uploads', 
        request.rows[0].document_path.replace('/uploads/', '')
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.status(204).end();
  } catch (err) {
    console.error('Error deleting request:', err);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error', details: err.message });
  }
  
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully');
  pool.end();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully');
  pool.end();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});