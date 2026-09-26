const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const axios = require('axios'); // 💡 เพิ่ม axios สำหรับยิง API ไปหา OpenChargeMap

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

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ==========================================
// 1. กลุ่ม API สำหรับฐานข้อมูล (Database)
// ==========================================

// API ดึงรุ่นรถจากส่วนกลางไปแสดงที่หน้าเว็บ
app.get('/api/ev-models', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ev_models ORDER BY brand, model');
        res.json({ success: true, models: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Database Error' });
    }
});

// API ล็อกอิน (ดึงข้อมูลผู้ใช้และรถกลับไปให้ Frontend)
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

// API สมัครสมาชิก (บันทึก User พร้อมข้อมูลรถ)
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

// API สำหรับแอดมิน ดึงข้อมูลทุกคน
app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT username, role FROM users ORDER BY role ASC, username ASC');
        res.json({ success: true, users: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลจากฐานข้อมูล' });
    }
});

// ==========================================
// 2. กลุ่ม API สำหรับแผนที่สถานีชาร์จ (ซ่อน API Key)
// ==========================================

// 1. API สำหรับค้นหาสถานีชาร์จแบบ 2 แหล่ง (Google Maps + OpenChargeMap) สำหรับคำนวณเส้นทาง
app.get('/api/stations', async (req, res) => {
    try {
        const { lat, lng, distance } = req.query;

        // 🔑 ตั้งค่า API Key ของทั้ง 2 แหล่ง
        const ocmApiKey = 'e2235a72-1320-4010-b9a1-b54cf27381d0';
        const googleApiKey = 'AIzaSyDX-7wEXvLsU6AfXXw9Zw-sbUjUAb4PRLc'; // 💡 อย่าลืมเปลี่ยนเป็น API Key ของ Google

        const radius = distance * 1000; // แปลงกิโลเมตรเป็นเมตรสำหรับ Google API

        // เตรียม URL สำหรับเรียก API
        const googleUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=charging_station&keyword=EV&language=th&key=${googleApiKey}`;
        const ocmUrl = `https://api.openchargemap.io/v3/poi?key=${ocmApiKey}&latitude=${lat}&longitude=${lng}&distance=${distance}&distanceunit=KM&maxresults=5`;

        // 🚀 ยิง Request ดึงข้อมูลพร้อมกันทั้ง 2 แหล่ง (ใช้ Promise.allSettled เพื่อไม่ให้ระบบล่มถ้าอันใดอันหนึ่งพัง)
        const [googleRes, ocmRes] = await Promise.allSettled([
            axios.get(googleUrl),
            axios.get(ocmUrl)
        ]);

        let combinedStations = [];

        // ส่วนที่ 1: จัดการข้อมูลจาก Google Maps (ถ้าดึงสำเร็จ)
        if (googleRes.status === 'fulfilled' && googleRes.value.data.results) {
            const gData = googleRes.value.data.results.map(st => ({
                lat: st.geometry.location.lat,
                lng: st.geometry.location.lng,
                title: st.name,
                operator: st.vicinity || 'ไม่ระบุที่อยู่',
                source: 'Google Maps' // แนบป้ายกำกับบอกที่มา
            }));
            combinedStations.push(...gData); // จับใส่ Array
        }

        // ส่วนที่ 2: จัดการข้อมูลจาก OpenChargeMap (ถ้าดึงสำเร็จ)
        if (ocmRes.status === 'fulfilled' && ocmRes.value.data) {
            const oData = ocmRes.value.data.map(st => ({
                lat: st.AddressInfo.Latitude,
                lng: st.AddressInfo.Longitude,
                title: st.AddressInfo.Title || 'สถานีชาร์จ EV',
                operator: st.OperatorInfo ? st.OperatorInfo.Title : 'ไม่ระบุผู้ให้บริการ',
                source: 'OpenChargeMap' // แนบป้ายกำกับบอกที่มา
            }));
            combinedStations.push(...oData); // จับใส่ Array ต่อท้าย
        }

        // ส่งข้อมูลที่จับรวมและจัดรูปแบบให้เหมือนกันแล้ว กลับไปให้ Frontend (map.js)
        res.json(combinedStations);
    } catch (error) {
        console.error("Combined API Error:", error.message);
        res.status(500).json({ error: "Failed to fetch stations" });
    }
});

// 2. API สำหรับดึงสถานีชาร์จมาวาดลงบนแผนที่โดยรวม (Bounding Box)
app.get('/api/stations/bounds', async (req, res) => {
    try {
        const { n, w, s, e } = req.query;
        const ocmApiKey = 'e2235a72-1320-4010-b9a1-b54cf27381d0';

        const url = `https://api.openchargemap.io/v3/poi?key=${ocmApiKey}&boundingbox=(${n},${w}),(${s},${e})&maxresults=500`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        console.error("Error fetching map bounds:", error.message);
        res.status(500).json({ error: "Failed to fetch map bounds" });
    }
});

// ==========================================
// 4. กลุ่ม API ประวัติการเดินทาง
// ==========================================

// API บันทึกประวัติการเดินทาง
app.post('/api/history', async (req, res) => {
    const { username, destination_name, start_lat, start_lng, end_lat, end_lng } = req.body;
    try {
        await pool.query(
            `INSERT INTO trip_history (username, destination_name, start_lat, start_lng, end_lat, end_lng)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [username, destination_name, start_lat, start_lng, end_lat, end_lng]
        );
        res.json({ success: true });
    } catch (error) {
        console.error("Save history error:", error);
        res.status(500).json({ error: "Failed to save history" });
    }
});

// API ดึงประวัติการเดินทางของผู้ใช้ (ดึง 10 รายการล่าสุด)
app.get('/api/history', async (req, res) => {
    const { username } = req.query;
    try {
        const result = await pool.query(
            'SELECT * FROM trip_history WHERE username = $1 ORDER BY created_at DESC LIMIT 10',
            [username]
        );
        res.json({ success: true, history: result.rows });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch history" });
    }
});

app.listen(port, () => console.log(`🚀 Server is running on port ${port}`));