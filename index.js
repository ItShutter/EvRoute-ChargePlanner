const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = 3000;

app.use(express.json());

const pool = new Pool({
    user: 'ev_admin',
    host: 'localhost',
    database: 'ev_planner',
    password: 'ev_password123',
    port: 5432,
});

app.use(express.static(path.join(__dirname, 'public')));

// 1. API ดึงรุ่นรถจากส่วนกลางไปแสดงที่หน้าเว็บ
app.get('/api/ev-models', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ev_models ORDER BY brand, model');
        res.json({ success: true, models: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Database Error' });
    }
});

// 2. API ล็อกอิน (ดึงข้อมูลผู้ใช้และรถกลับไปให้ Frontend)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
});

// 3. API สมัครสมาชิก (บันทึก User พร้อมข้อมูลรถ)
app.post('/api/register', async (req, res) => {
    const { username, password, brand, model, range_km, battery_capacity_kwh } = req.body;

    try {
        // เช็กชื่อซ้ำ
        const check = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (check.rows.length > 0) {
            return res.status(400).json({ success: false, message: '❌ ชื่อผู้ใช้งานนี้มีคนใช้แล้ว!' });
        }

        // บันทึกลงตาราง users
        const result = await pool.query(
            `INSERT INTO users (username, password, role, current_battery, ev_brand, ev_model, ev_range_km, ev_capacity_kwh) 
             VALUES ($1, $2, 'member', 100, $3, $4, $5, $6) RETURNING *`,
            [username, password, brand, model, range_km, battery_capacity_kwh]
        );

        res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ!', user: result.rows[0] });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
    }
});

// 4. API สำหรับแอดมิน ดึงข้อมูลทุกคน
app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT username, role FROM users ORDER BY role ASC, username ASC');
        res.json({ success: true, users: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลจากฐานข้อมูล' });
    }
});

app.listen(port, () => console.log(`🚀 Server is running on port ${port}`));