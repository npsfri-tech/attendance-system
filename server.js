// backend/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { v4: uuid } = require('uuid');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// Middleware
app.use(cors());
app.use(express.json());

const path = require('path');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// Database Connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// API Routes

// 1. Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );

        res.json({
            message: 'Login successful',
            user: { id: user.id, email: user.email, role: user.role, name: user.name },
            token
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// 2. Register


app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name, role, studentId, department, course } = req.body;

        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = uuid();

        const existing = await pool.query(
  'SELECT * FROM users WHERE email=$1',
  [email]
);

if (existing.rows.length > 0) {
  return res.status(400).json({
    error: 'Email already registered'
  });
}

        await pool.query(
            'INSERT INTO users (id, email, password, name, role) VALUES ($1, $2, $3, $4, $5)',
            [userId, email, hashedPassword, name, role]
        );

        if (role === 'STUDENT') {
            await pool.query(
                'INSERT INTO students (id, user_id, student_id, department, course) VALUES ($1, $2, $3, $4, $5)',
                [uuid(), userId, studentId, department, course]
            );
        }

        res.status(201).json({ message: 'Registration successful' });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// 3. Create Attendance Session
app.post('/api/sessions', authenticateToken, async (req, res) => {
    try {
        const { courseId, date, startTime, endTime, topic } = req.body;
        const sessionId = uuid();
        const sessionCode = `ATT-${new Date(date).toISOString().slice(0, 10)}-${uuid().slice(0, 4)}`;

        await pool.query(
            'INSERT INTO sessions (id, session_code, course_id, date, start_time, end_time, topic, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [sessionId, sessionCode, courseId, date, startTime, endTime, topic, 'ACTIVE']
        );

        res.status(201).json({ message: 'Session created', sessionId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create session' });
    }
});

// 4. Mark Attendance
app.post('/api/attendance/mark', authenticateToken, async (req, res) => {
  try {
    console.log("Attendance Request:", req.body);

    const { sessionId, studentId, status } = req.body;

    const recordId = uuid();

    await pool.query(
      `INSERT INTO attendance_records
       (id, session_id, student_id, status, marked_at)
       VALUES ($1,$2,$3,$4,NOW())`,
      [recordId, sessionId, studentId, status]
    );

    io.emit('attendance_updated', {
      sessionId,
      studentId,
      status
    });

    res.json({
      success: true,
      message: 'Attendance marked'
    });

  } catch (error) {
    console.error("Attendance Error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

// 5. Get Session Attendance
app.get('/api/sessions/:sessionId/attendance', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.params;

       const result = await pool.query(`
    SELECT
        s.id,
        s.student_id,
        u.name,
        u.email,
        'ABSENT' as status
    FROM students s
    JOIN users u ON s.user_id = u.id
    `);

    onclick="markAttendance('${sessionId}', '${record.id}', 'PRESENT')"


        res.json({ records: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch attendance' });
    }
});

// 6. Get Dashboard Stats

app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const totalStudents = await pool.query(
            'SELECT COUNT(*) FROM students'
        );

        const totalFaculty = await pool.query(
            "SELECT COUNT(*) FROM users WHERE role = 'FACULTY'"
        );

        const totalSessions = await pool.query(
            'SELECT COUNT(*) FROM sessions'
        );

        const today = new Date().toISOString().slice(0,10);

        const todayPresent = await pool.query(
            `SELECT COUNT(*) FROM attendance_records
             WHERE status = 'PRESENT'
             AND session_id IN (
                SELECT id FROM sessions WHERE date = $1
             )`,
            [today]
        );

        const todayTotal = await pool.query(
            `SELECT COUNT(*) FROM attendance_records
             WHERE session_id IN (
                SELECT id FROM sessions WHERE date = $1
             )`,
            [today]
        );

        res.json({
            stats: {
                totalStudents: totalStudents.rows[0].count,
                totalFaculty: totalFaculty.rows[0].count,
                totalSessions: totalSessions.rows[0].count,
                todayAttendance:
                    Number(todayTotal.rows[0].count) > 0
                        ? (Number(todayPresent.rows[0].count) /
                           Number(todayTotal.rows[0].count)) * 100
                        : 0
            }
        });

    } catch (error) {
        console.error("Dashboard Error:", error);
        res.status(500).json({ error: error.message });
    }
});
// app.get('/api/dashboard', authenticateToken, async (req, res) => {
//     try {
//         const totalStudents = await pool.query('SELECT COUNT(*) FROM students');
//         const totalFaculty = await pool.query(`SELECT COUNT(*) FROM users WHERE role = 'FACULTY'`);
//         const totalSessions = await pool.query('SELECT COUNT(*) FROM sessions');

//         const today = new Date().toISOString().slice(0, 10);
//         const todayPresent = await pool.query(
//             `SELECT COUNT(*) FROM attendance_records 
//        WHERE status = 'PRESENT' AND session_id IN (SELECT id FROM sessions WHERE date LIKE $1)`,
//             [today]
//         );
//         const todayTotal = await pool.query(
//             `SELECT COUNT(*) FROM attendance_records 
//        WHERE session_id IN (SELECT id FROM sessions WHERE date = $1::date)`,
//             [today]
//         );

//         res.json({
//             stats: {
//                 totalStudents: totalStudents.rows[0].count,
//                 totalFaculty: totalFaculty.rows[0].count,
//                 totalSessions: totalSessions.rows[0].count,
//                 todayAttendance: todayTotal.rows[0].count > 0
//                     ? (todayPresent.rows[0].count / todayTotal.rows[0].count * 100)
//                     : 0
//             }
//         });
//     }catch (error) {
//     console.error("Dashboard Error:", error);
//     res.status(500).json({
//         error: error.message
//     });
// }
// });

// Middleware
function authenticateToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// Socket.io
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
});

// Database Setup (Run once)
async function setupDatabase() {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255),
        name VARCHAR(255),
        role VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS students (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id),
        student_id VARCHAR(100) UNIQUE,
        department VARCHAR(255),
        course VARCHAR(255),
        semester INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        session_code VARCHAR(100),
        course_id VARCHAR(255),
        date DATE,
        start_time VARCHAR(50),
        end_time VARCHAR(50),
        topic VARCHAR(255),
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS attendance_records (
        id UUID PRIMARY KEY,
        session_id UUID REFERENCES sessions(id),
        student_id UUID REFERENCES students(id),
        status VARCHAR(50),
        marked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

        console.log('✅ Database setup complete');
    } catch (error) {
        console.error('Database error:', error);
    }
}

app.get('/api/sessions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM sessions ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});


setupDatabase();

app.get('/api/analytics', authenticateToken, async (req, res) => {
  try {
    const distribution = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM attendance_records
      GROUP BY status
    `);

    const topPerformers = await pool.query(`
      SELECT
        u.name,
        s.student_id,
        ROUND(
          100.0 * SUM(CASE WHEN ar.status='PRESENT' THEN 1 ELSE 0 END)
          / COUNT(*),
          2
        ) as percentage
      FROM attendance_records ar
      JOIN students s ON ar.student_id = s.id
      JOIN users u ON s.user_id = u.id
      GROUP BY u.name, s.student_id
      ORDER BY percentage DESC
      LIMIT 5
    `);

    res.json({
      distribution: distribution.rows,
      topPerformers: topPerformers.rows
    });

  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Analytics failed' });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV}`);
});

module.exports = { app, server, io };
