# ⚡ EV Route & Charge Planner

โปรเจกต์แอปพลิเคชันเว็บจำลองการวางแผนเส้นทางสำหรับรถยนต์ไฟฟ้า (EV) พร้อมระบบแนะนำจุดแวะชาร์จอัตโนมัติ คำนวณจากความจุแบตเตอรี่รถยนต์ของผู้ใช้งาน และสามารถค้นหาสถานีชาร์จแบบ Real-time ตามพิกัดบนแผนที่

## 🎯 ที่มาและความสำคัญ
* ขจัดปัญหา Range Anxiety
* แก้ปัญหาหลักผู้ใช้รถกังวลแบตเตอรี่หมดกลางทางและหาสถานีชาร์จไม่ตรงรุ่น
* เป้าหมายของระบบคือการคำนวณเส้นทางและจุดแวะชาร์จอัตโนมัติอ้างอิงสเปกรถจริง

## 🏗️ การออกแบบ Data Model (OOP Concept)
โปรเจกต์นี้ประยุกต์ใช้แนวคิดการเขียนโปรแกรมเชิงวัตถุ (Object-Oriented Programming) ในการออกแบบสถาปัตยกรรมระบบ:
* **Object & Class:** มีการจำลองส่วนประกอบในระบบเป็นคลาส ได้แก่ User, EV_Vehicle และ ChargingStation
* **Encapsulation:** มีการซ่อนข้อมูลผ่าน API ป้องกันการเข้าถึงฐานข้อมูลโดยตรง เพื่อความปลอดภัย
* **Behavior:** วัตถุในระบบมีพฤติกรรมคำนวณระยะทางและหักลบแบตเตอรี่อัตโนมัติ

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)
- **Frontend:** HTML, CSS, JavaScript (Leaflet.js, OpenStreetMap)
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **APIs:** Open Charge Map API (ข้อมูลสถานีชาร์จ), Overpass API (OSM)

## 🚀 วิธีการติดตั้งและรันโปรแกรมบนเครื่องส่วนตัว (Local Environment)
เพื่อป้องกันผลกระทบกับระบบโดเมนและฐานข้อมูลที่กำลังใช้งานจริง กรุณารันโปรเจกต์นี้เพื่อทดสอบผ่าน Localhost ตามขั้นตอนต่อไปนี้:

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
```

2. การรันเซิร์ฟเวอร์ (Node.js)

    2.1 ดาวน์โหลด Source Code ของโปรเจกต์ (Download ZIP) หรือทำการ Clone โปรเจกต์ลงมาที่เครื่องของคุณ

    2.2 ตรวจสอบให้แน่ใจว่าเครื่องคอมพิวเตอร์ของคุณติดตั้ง Node.js เรียบร้อยแล้ว

    2.3 เปิด Terminal หรือ Command Prompt แล้ว cd เข้าไปที่โฟลเดอร์ของโปรเจกต์

    2.4 ติดตั้งแพ็กเกจ (Dependencies) ที่จำเป็นทั้งหมดด้วยคำสั่ง:
     ```bash
        npm install
     ```
    2.5 สั่งรันเซิร์ฟเวอร์ด้วยคำสั่ง:
     ```Bash
        node index.js
     ```

    2.6 เปิดเว็บเบราว์เซอร์ และพิมพ์ URL เพื่อเข้าใช้งานระบบที่: http://localhost:3000 (หรือพอร์ตที่แสดงใน Terminal)
