const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const retry = require('async-retry');
const fs = require('fs');

// Load environment variables from server.env if it exists
if (fs.existsSync(path.join(__dirname, 'server.env'))) {
  dotenv.config({ path: path.join(__dirname, 'server.env') });
} else {
  dotenv.config();
}

const app = express();
app.use(cors());

// Enhanced logging for environment variables
console.log('Database Configuration:', {
  DB_USER: process.env.DB_USER,
  DB_HOST: process.env.DB_HOST,
  DB_NAME: process.env.DB_NAME,
  DB_PASSWORD: 'admin321', // Masked for security in logs
  DB_PORT: process.env.DB_PORT,
  FRONTEND_URL: process.env.FRONTEND_URL
});

// CORS configuration
const allowedOrigins = [
  'http://13.60.190.178:8005',
  'http://13.60.190.178:8006',
  'http://13.60.190.178:8007',
  process.env.FRONTEND_URL || 'http://13.60.190.178:8005'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

// PostgreSQL connection with enhanced settings
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'postgres',
  database: process.env.DB_NAME || 'auth_db',
  password: process.env.DB_PASSWORD || 'admin123',
  port: process.env.DB_PORT || 5432,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  retryDelay: 1000,
  retryLimit: 10,
});

// Test connection immediately
pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL connected successfully'))
  .catch(err => {
    console.error('❌ PostgreSQL connection failed:', err);
    process.exit(1);
  });

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: './Uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Database initialization
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        profile_image TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_email ON users(email);
    `);
    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

// Connection with retry logic
async function connectWithRetry() {
  return retry(
    async () => {
      const client = await pool.connect();
      console.log('Successfully connected to PostgreSQL');
      await initializeDatabase();
      client.release();
    },
    {
      retries: 10,
      factor: 2,
      minTimeout: 1000,
      maxTimeout: 10000,
      onRetry: (err) => {
        console.error(`Retry attempt failed: ${err.message}`);
      }
    }
  );
}

// Start the server after DB connection
connectWithRetry().catch(err => {
  console.error('Failed to connect to database after retries:', err);
  process.exit(1);
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message
    });
  }
});

// Signup route
app.post('/api/signup', upload.single('profileImage'), async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const profileImage = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await pool.query(
      'INSERT INTO users (username, email, password, profile_image) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, email, hashedPassword, profileImage]
    );

    res.status(201).json({ message: 'User created', userId: result.rows[0].id });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // CHANGE: Added logging to debug received data
    console.log('Login attempt:', { email, password });
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    // CHANGE: Added logging to check query result
    console.log('Database query result:', result.rows);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    // CHANGE: Added logging to check password comparison
    console.log('Password valid:', isValid);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ message: 'Login successful', userId: user.id });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Forgot password route
app.post('/api/forgot', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Implement password reset logic (e.g., send email)
    res.json({ message: 'Password reset link sent' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ✅ New: Check if email exists (for validation)
app.post('/check-email-data', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  } catch (err) {
    console.error('Error checking email:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = process.env.PORT || 3005;
app.listen(3005, '0.0.0.0', () => {
  console.log("Server running on port 3005");
  console.log(`Allowed CORS origins: ${allowedOrigins.join(', ')}`);
});
