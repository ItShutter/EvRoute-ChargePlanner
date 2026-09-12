# ⚡ EV Route & Charge Planner

โปรเจกต์แอปพลิเคชันเว็บจำลองการวางแผนเส้นทางสำหรับรถยนต์ไฟฟ้า (EV) พร้อมระบบแนะนำจุดแวะชาร์จอัตโนมัติ คำนวณจากความจุแบตเตอรี่รถยนต์ของผู้ใช้งาน และสามารถค้นหาสถานีชาร์จแบบ Real-time ตามพิกัดบนแผนที่

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)
- **Frontend:** HTML, CSS, JavaScript (Leaflet.js, OpenStreetMap)
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **APIs:** Open Charge Map API (ข้อมูลสถานีชาร์จ), Overpass API (OSM)

## 🚀 วิธีการรันโปรเจกต์ (Setup Instructions)

**1. การตั้งค่าฐานข้อมูล (PostgreSQL)**
โปรเจกต์นี้จำเป็นต้องใช้ฐานข้อมูล กรุณาสร้าง Database ชื่อ `ev_planner` และรันคำสั่ง SQL ด้านล่างนี้เพื่อสร้างตารางข้อมูลพื้นฐาน:

```sql
CREATE TABLE ev_models (
    id SERIAL PRIMARY KEY,
    brand VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    range_km NUMERIC NOT NULL,
    battery_capacity_kwh NUMERIC NOT NULL
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'member',
    current_battery NUMERIC DEFAULT 100,
    ev_brand VARCHAR(100),
    ev_model VARCHAR(100),
    ev_range_km NUMERIC,
    ev_capacity_kwh NUMERIC
);

-- บัญชีแอดมินเริ่มต้น
INSERT INTO users (username, password, role, ev_brand, ev_model, ev_range_km, ev_capacity_kwh) 
VALUES ('admin', '123456', 'admin', 'BYD', 'Atto 3 Extended', 480, 60.4);
