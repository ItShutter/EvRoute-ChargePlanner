
        let currentUser = { current_battery: 100, username: 'Guest' };
        let myEV = { brand: 'BYD', model: 'Atto 3 Extended', range_km: 480 };

        try {
            const savedUser = JSON.parse(localStorage.getItem('currentUser'));
            if (savedUser) {
                currentUser = savedUser;
                document.getElementById('display-username').textContent = currentUser.username;
            }
            const savedEV = JSON.parse(localStorage.getItem('myEV'));
            if (savedEV) myEV = savedEV;
        } catch (e) { console.warn("Using default vehicle data"); }

        if (currentUser && myEV) {
            document.getElementById('status-car-name').textContent = `🚗 ${myEV.brand} ${myEV.model}`;
            document.getElementById('status-battery').textContent = `${currentUser.current_battery || 100}%`;
        }

        const map = L.map('map').setView([13.7563, 100.5018], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

        let userLocation = null;
        let chargeMarkers = [];
        const chargeStopIcon = L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/256/13458/13458710.png',
            iconSize: [60, 60],
            iconAnchor: [30, 60],
            popupAnchor: [0, -60]
        });

        const warningStopIcon = L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
            iconSize: [35, 35],
            iconAnchor: [17, 35],
            popupAnchor: [0, -35]
        });
        
        let routingControl = null;
        let loadedStations = new Set();
        let searchMarker = null;
        let tripOrigin = null;
        let tripDestination = null;

        const markersCluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
        map.addLayer(markersCluster);

        const evIcon = L.divIcon({
            html: `<div style="background-color: #10b981; width: 36px; height: 36px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg></div>`,
            className: 'modern-ev-marker', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18]
        });

        // --- ฟังก์ชันแสดงแผงสรุปเส้นทางแบบ Timeline ---
        function showRouteSummary(totalDistanceKm, totalTimeMinutes, waypoints) {
            try {
                const panel = document.getElementById('route-summary-panel');
                const timelineContainer = document.getElementById('route-timeline');

                if (!panel || !timelineContainer) return;

                document.getElementById('summary-dist').textContent = `${totalDistanceKm} km`;
                const hours = Math.floor(totalTimeMinutes / 60);
                const mins = Math.round(totalTimeMinutes % 60);
                document.getElementById('summary-time').textContent = `${hours}h ${mins}m`;
                document.getElementById('summary-text').textContent = `การเดินทางระยะทางรวม ${totalDistanceKm} กม. วันนี้ขับขี่ปลอดภัยนะครับ!`;

                timelineContainer.innerHTML = '';
                waypoints.forEach(wp => {
                    let badgeHtml = '';
                    if (wp.type === 'charge') {
                        badgeHtml = `<div style="margin-top: 5px;">
                        <span class="timeline-badge">🔌 +${wp.chargeTimeMins} นาที</span>
                        <span class="timeline-badge" style="background:#f3f4f6; color:#4b5563;">เป้าหมาย: ${wp.targetBattery}%</span>
                    </div>`;
                    }
                    const itemHtml = `<div class="timeline-item ${wp.type}">
                    <div style="font-size: 11px; color: #9ca3af; margin-bottom: 2px;">${wp.label}</div>
                    <div class="timeline-title">${wp.title}</div>
                    <div class="timeline-desc">${wp.desc}</div>
                    ${badgeHtml}
                </div>`;
                    timelineContainer.insertAdjacentHTML('beforeend', itemHtml);
                });

                // บังคับแสดงผล
                panel.classList.remove('hidden');
                panel.style.display = 'block';
                panel.style.zIndex = '9999';
            } catch (err) {
                console.error("Error rendering summary:", err);
            }
        }

        // ฟังก์ชันช่วยหาพิกัด LatLng ตามระยะทางจริง (ป้องกัน Error L.latLng)
        function getPointAtDistance(coords, targetKm) {
            let accumulatedMeters = 0;
            const targetMeters = targetKm * 1000;
            for (let i = 0; i < coords.length - 1; i++) {
                const p1 = L.latLng(coords[i].lat, coords[i].lng);
                const p2 = L.latLng(coords[i + 1].lat, coords[i + 1].lng);
                const d = p1.distanceTo(p2);

                if (accumulatedMeters + d >= targetMeters) {
                    return coords[i];
                }
                accumulatedMeters += d;
            }
            return coords[coords.length - 1];
        }

        // ตัวแปรสำหรับระบบคำนวณ 2 รอบ
        let isOptimizing = false;
        let plannedTimeline = [];

        // ฟังก์ชันคำนวณและวางแผนจุดแวะชาร์จตลอดเส้นทาง (Two-Pass Routing)
        function calculateAndDisplayRoute(destination) {
            if (!userLocation) { alert("ยังไม่พบตำแหน่งเริ่มต้นของคุณ กรุณารอสักครู่"); return; }

            tripOrigin = userLocation;
            tripDestination = destination;

            if (routingControl) map.removeControl(routingControl);

            isOptimizing = true;
            plannedTimeline = [];

            routingControl = L.Routing.control({
                waypoints: [tripOrigin, tripDestination],
                routeWhileDragging: false, addWaypoints: false, show: false,
                lineOptions: { styles: [{ color: '#3b82f6', opacity: 0.8, weight: 6 }] }
            });

            routingControl.on('routingerror', function (err) {
                console.error("Routing Error:", err);
                alert("เซิร์ฟเวอร์นำทางขัดข้องชั่วคราว หรือระยะทางไกลเกินไป");
            });

            routingControl.on('routesfound', async function (event) {
                if (!isOptimizing) {
                    // รอบที่ 2: วาดเส้นทางที่แทรกจุดแวะเรียบร้อยแล้ว
                    const routes = event.routes;
                    const summary = routes[0].summary;
                    const finalDistanceKm = parseFloat((summary.totalDistance / 1000).toFixed(1));
                    const finalTimeMinutes = summary.totalTime / 60;
                    
                    showRouteSummary(finalDistanceKm, finalTimeMinutes, plannedTimeline);
                    return;
                }

                // รอบที่ 1: คำนวณหาสถานีชาร์จ
                const routes = event.routes;
                const summary = routes[0].summary;
                const routeCoords = routes[0].coordinates;

                const totalDistanceKm = parseFloat((summary.totalDistance / 1000).toFixed(1));

                chargeMarkers.forEach(marker => map.removeLayer(marker));
                chargeMarkers = [];

                const currentBatt = currentUser.current_battery || 100;
                const evRange = myEV.range_km || 480;
                let currentBatteryKm = evRange * (currentBatt / 100);

                plannedTimeline.push({
                    type: 'start', label: 'จุดเริ่มต้น', title: 'ตำแหน่งปัจจุบันของคุณ',
                    desc: `แบตเตอรี่เริ่มต้น ${currentBatt}% (วิ่งได้อีกประมาณ ${Math.round(currentBatteryKm)} กม.)`
                });

                let newWaypoints = [tripOrigin]; 

                if (totalDistanceKm > currentBatteryKm) {
                    const ocmApiKey = 'e2235a72-1320-4010-b9a1-b54cf27381d0';
                    let currentPosKm = 0;
                    let availableKm = currentBatteryKm;
                    let stopCount = 1;

                    while (currentPosKm + availableKm < totalDistanceKm) {
                        const safeTargetKm = currentPosKm + availableKm - 30; // รักษาระยะเซฟตี้ 30 กม.
                        let stationFound = null;

                        // สแกนละเอียดทีละ 10 กม. ออกนอกเส้นทางไม่เกิน 30 กม.
                        for (let offset = 0; offset <= 80; offset += 10) {
                            const scanKm = safeTargetKm - offset;
                            if (scanKm <= currentPosKm) break;

                            const scanPoint = getPointAtDistance(routeCoords, scanKm);
                            try {
                                const url = `https://api.openchargemap.io/v3/poi?key=${ocmApiKey}&latitude=${scanPoint.lat}&longitude=${scanPoint.lng}&distance=30&distanceunit=KM&maxresults=5`;
                                const res = await fetch(url);
                                const data = await res.json();

                                if (data && data.length > 0) {
                                    stationFound = {
                                        data: data[0],
                                        atKm: Math.round(scanKm)
                                    };
                                    break;
                                }
                            } catch (err) {
                                console.error("OCM Fetch error:", err);
                            }
                        }

                        if (stationFound) {
                            const st = stationFound.data;
                            const stLat = parseFloat(st.AddressInfo.Latitude);
                            const stLng = parseFloat(st.AddressInfo.Longitude);
                            const stTitle = st.AddressInfo.Title || 'สถานีชาร์จ EV';
                            const stOperator = st.OperatorInfo ? st.OperatorInfo.Title : 'ไม่ระบุผู้ให้บริการ';

                            if (!isNaN(stLat) && !isNaN(stLng)) {
                                const stLatLng = L.latLng(stLat, stLng);
                                newWaypoints.push(stLatLng); // ยัดพิกัดสถานีใส่ Waypoint บังคับเส้นทางเบี่ยง

                                const marker = L.marker([stLat, stLng], { icon: chargeStopIcon })
                                    .addTo(map)
                                    .bindPopup(`
                                        <div style="text-align: center; font-family: 'Segoe UI', sans-serif;">
                                            <b style="color: #eab308; font-size: 16px;">⚡ จุดแวะชาร์จที่ ${stopCount}</b><br>
                                            <strong style="color: #1f2937;">${stTitle}</strong><br>
                                            <span style="color: #6b7280; font-size: 12px;">ผู้ให้บริการ: ${stOperator}</span><br>
                                            <span style="color: #10b981; font-size: 12px;">(จุดแวะบนเส้นทาง)</span>
                                        </div>
                                    `);
                                chargeMarkers.push(marker);

                                plannedTimeline.push({
                                    type: 'charge',
                                    label: `จุดชาร์จที่ ${stopCount}`,
                                    title: `แวะชาร์จที่ ${stTitle}`,
                                    desc: `ผู้ให้บริการ: ${stOperator}`,
                                    chargeTimeMins: 45,
                                    targetBattery: 90
                                });

                                currentPosKm = stationFound.atKm;
                                availableKm = evRange * 0.90;
                            } else {
                                stationFound = null;
                            }
                        }

                        if (!stationFound) {
                            const warningPoint = getPointAtDistance(routeCoords, safeTargetKm);
                            if (warningPoint) {
                                const marker = L.marker([warningPoint.lat, warningPoint.lng], { icon: warningStopIcon })
                                    .addTo(map)
                                    .bindPopup(`
                                        <div style="text-align: center; font-family: 'Segoe UI', sans-serif;">
                                            <b style="color: #ef4444; font-size: 16px;">⚠️ จุดเตือนแบตเตอรี่ต่ำ</b><br>
                                            <span style="color: #6b7280; font-size: 13px;">ช่วง กม. ที่ ${Math.round(safeTargetKm)}</span><br>
                                            <span style="color: #ef4444; font-size: 12px; font-weight: bold;">ไม่พบสถานีชาร์จในรัศมี 30 กม. กรุณาวางแผนล่วงหน้า!</span>
                                        </div>
                                    `);
                                chargeMarkers.push(marker);
                            }

                            plannedTimeline.push({
                                type: 'charge',
                                label: `จุดเตือนที่ ${stopCount}`,
                                title: `ต้องการแวะชาร์จ (กม. ที่ ${Math.round(safeTargetKm)})`,
                                desc: `<span style="color:#ef4444; font-weight:bold;">⚠️ ไม่พบสถานีชาร์จในรัศมี 30 กม.</span>`,
                                chargeTimeMins: 45,
                                targetBattery: 90
                            });

                            currentPosKm = safeTargetKm;
                            availableKm = evRange * 0.90;
                        }
                        stopCount++;
                    }
                }

                plannedTimeline.push({
                    type: 'end', label: 'ถึงที่หมาย', title: 'จุดหมายปลายทาง',
                    desc: `เดินทางถึงจุดหมายอย่างปลอดภัย`
                });

                newWaypoints.push(tripDestination); // ยัดจุดหมายปลายทางเป็นจุดสุดท้าย

                // เปลี่ยนสถานะและสั่งให้ Routing คำนวณเส้นทางใหม่ที่ลากผ่านสถานี
                isOptimizing = false;
                routingControl.setWaypoints(newWaypoints);
            });

            routingControl.addTo(map);
        }

        // แก้ไขช่องค้นหาไม่ให้ชนกับการซูมของแผนที่
        function searchLocation() {
            const query = document.getElementById('search-input').value.trim();
            if (!query) return;
            // บังคับค้นหาในไทย
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=th`;
            
            fetch(url).then(res => res.json()).then(data => {
                if (data && data.length > 0) {
                    const lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
                    const destName = data[0].display_name;
                    
                    if (searchMarker) map.removeLayer(searchMarker);
                    searchMarker = L.marker([lat, lon]).addTo(map).bindPopup(`<b>🔍 ${destName}</b>`).openPopup();
                    
                    calculateAndDisplayRoute(L.latLng(lat, lon));

                    if (userLocation) {
                        saveTripHistory(userLocation.lat, userLocation.lng, lat, lon, destName);
                    }
                } else alert("ไม่พบสถานที่ ลองเปลี่ยนคำค้นหาให้ชัดเจนขึ้นครับ");
            }).catch(err => console.error("Search Error:", err));
        }

        function handleSearchKey(event) { 
            if (event.key === 'Enter') {
                event.preventDefault(); // ป้องกันเว็บรีเฟรช
                searchLocation(); 
            }
        }

        // --- ดึงสถานีชาร์จ Bounding Box ---
        function fetchStationsInView() {
            const bounds = map.getBounds();
            const s = bounds.getSouth(), n = bounds.getNorth(), w = bounds.getWest(), e = bounds.getEast();
            const ocmApiKey = 'e2235a72-1320-4010-b9a1-b54cf27381d0';

            const ocmUrl = `https://api.openchargemap.io/v3/poi?key=${ocmApiKey}&boundingbox=(${n},${w}),(${s},${e})&maxresults=500`;
            const overpassQuery = `[out:json][timeout:25];(node["amenity"="charging_station"](${s},${w},${n},${e});way["amenity"="charging_station"](${s},${w},${n},${e}););out center;`;

            Promise.all([
                fetch(ocmUrl).then(res => res.json()).catch(() => []),
                fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: overpassQuery }).then(res => res.json()).catch(() => ({ elements: [] }))
            ]).then(([ocmData, osmData]) => {
                const newMarkers = [];

                if (Array.isArray(ocmData)) {
                    ocmData.forEach(station => {
                        if (station.AddressInfo && station.AddressInfo.ID) {
                            const id = `ocm_${station.ID || station.AddressInfo.ID}`;
                            if (!loadedStations.has(id)) {
                                loadedStations.add(id);

                                const title = station.AddressInfo.Title || 'สถานีชาร์จ EV';
                                const operator = station.OperatorInfo ? station.OperatorInfo.Title : 'ไม่ระบุผู้ให้บริการ';
                                const usageType = station.UsageType ? station.UsageType.Title : 'ไม่ระบุเงื่อนไขการใช้งาน';
                                const usageCost = station.UsageCost ? station.UsageCost : 'ไม่ระบุค่าบริการ (Not specified)';

                                let connHtml = '<div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">';
                                if (station.Connections && station.Connections.length > 0) {
                                    station.Connections.forEach(conn => {
                                        const type = conn.ConnectionType ? conn.ConnectionType.Title : 'ไม่ระบุชนิด';
                                        const power = conn.PowerKW ? `${conn.PowerKW} kW` : 'กำลังไฟไม่ระบุ';
                                        const qty = conn.Quantity ? `${conn.Quantity} หัว` : '';
                                        const current = conn.CurrentType ? conn.CurrentType.Title : ''; 
                                        const status = conn.StatusType ? conn.StatusType.Title : 'Operational';

                                        connHtml += `
                                        <div style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 10px; border-radius: 8px;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                                <strong style="color: #065f46; font-size: 13px;">🔌 ${type} ${current ? `<span style="color:#6b7280; font-size:11px;">(${current})</span>` : ''}</strong>
                                                <span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight:bold;">${power}</span>
                                            </div>
                                            <div style="font-size: 11px; color: #047857;">จำนวน: ${qty} | สถานะ: ${status}</div>
                                        </div>`;
                                    });
                                } else {
                                    connHtml += '<div style="font-size: 12px; color: #9ca3af; text-align: center;">ไม่มีข้อมูลหัวชาร์จ</div>';
                                }
                                connHtml += '</div>';

                                const popupContent = `
                                <div style="min-width: 250px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                                    <h4 style="margin: 0 0 5px 0; color: #10b981; font-size: 15px; border-bottom: 2px solid #ecfdf5; padding-bottom: 5px; line-height: 1.3;">⚡ ${title}</h4>
                                    <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">🏢 <b>Operator:</b> ${operator}</div>
                                    <div style="font-size: 11px; color: #6b7280; margin-bottom: 8px;">💳 <b>Access:</b> ${usageType}<br>💰 <b>Cost:</b> ${usageCost}</div>
                                    <div style="font-size: 13px; font-weight: bold; color: #1f2937; margin-top: 10px;">Connectors & power:</div>
                                    ${connHtml} <!-- แก้ไข Syntax Error ตรงนี้แล้ว -->
                                </div>
                                `;

                                const marker = L.marker([station.AddressInfo.Latitude, station.AddressInfo.Longitude], { icon: evIcon })
                                    .bindPopup(popupContent);
                                newMarkers.push(marker);
                            }
                        }
                    });
                }

                (osmData.elements || []).forEach(station => {
                    const id = `osm_${station.id}`;
                    if (!loadedStations.has(id)) {
                        const lat = station.lat || (station.center && station.center.lat);
                        const lng = station.lon || (station.center && station.center.lon);
                        if (lat && lng) {
                            loadedStations.add(id);
                            const tags = station.tags || {};

                            let title = tags.name || tags['name:en'] || tags.brand || tags.operator || 'สถานีชาร์จ (ไม่มีชื่อ)';
                            if (title === tags.brand || title === tags.operator) {
                                title = `สถานีชาร์จ ${title}`;
                            }
                            const operator = tags.operator || tags.brand || 'ไม่ระบุผู้ให้บริการ';

                            let osmConnHtml = '<div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">';
                            let hasConnData = false;

                            if (tags['socket:type2_combo'] || tags['socket:type2'] || tags['socket:chademo']) {
                                hasConnData = true;
                                const createOsmBadge = (name, count) => `
                                <div style="background: #f3f4f6; border: 1px solid #d1d5db; padding: 8px; border-radius: 8px; font-size: 12px; color: #374151;">
                                    🔌 <b>${name}</b>: ${count} หัว
                                </div>`;

                                if (tags['socket:type2_combo']) osmConnHtml += createOsmBadge('CCS2 (DC)', tags['socket:type2_combo']);
                                if (tags['socket:type2']) osmConnHtml += createOsmBadge('Type 2 (AC)', tags['socket:type2']);
                                if (tags['socket:chademo']) osmConnHtml += createOsmBadge('CHAdeMO', tags['socket:chademo']);
                            }

                            if (!hasConnData) {
                                osmConnHtml += '<div style="font-size: 12px; color: #9ca3af; text-align: center;">ไม่มีข้อมูลหัวชาร์จเชิงลึก</div>';
                            }
                            osmConnHtml += '</div>';

                            const popupContent = `
                            <div style="min-width: 220px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                                <h4 style="margin: 0 0 5px 0; color: #3b82f6; font-size: 14px; border-bottom: 2px solid #eff6ff; padding-bottom: 5px;">📍 ${title} <span style="font-size:10px; color:#9ca3af;">(OSM)</span></h4>
                                <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">🏢 <b>Operator:</b> ${operator}</div>
                                <div style="font-size: 13px; font-weight: bold; color: #1f2937;">รายละเอียดจากพื้นที่:</div>
                                ${osmConnHtml}
                            </div>
                        `;

                            const marker = L.marker([lat, lng], { icon: evIcon }).bindPopup(popupContent);
                            newMarkers.push(marker);
                        }
                    }
                });

                if (newMarkers.length > 0) markersCluster.addLayers(newMarkers);
            });
        }
            
        fetchStationsInView();
        map.on('moveend', function () { if (map.getZoom() >= 8) fetchStationsInView(); });

        map.on('locationfound', function (e) {
            userLocation = e.latlng;
            L.marker(userLocation).addTo(map).bindPopup(`<b>📍 จุดเริ่มต้นของคุณ</b>`).openPopup();
            map.setView(userLocation, 12);
        });

        map.on('locationerror', function (e) {
            userLocation = L.latLng(13.8771, 100.4118);
            L.marker(userLocation).addTo(map).bindPopup(`<b>📍 จุดเริ่มต้น (บางใหญ่)</b>`).openPopup();
            map.setView(userLocation, 12);
        });
        map.locate({ setView: false, timeout: 5000 });

        map.on('click', function (e) { calculateAndDisplayRoute(e.latlng); });

        document.getElementById('user-status').addEventListener('click', function () {
            document.getElementById('profile-modal').style.display = 'flex';
            document.getElementById('edit-brand').value = myEV.brand || 'BYD';
            document.getElementById('edit-model').value = myEV.model || 'Atto 3';
            document.getElementById('edit-range').value = myEV.range_km || 480;
            document.getElementById('edit-battery').value = currentUser.current_battery || 100;
        });

        function closeProfileModal() { document.getElementById('profile-modal').style.display = 'none'; }
        function saveProfile() {
            myEV.brand = document.getElementById('edit-brand').value;
            myEV.model = document.getElementById('edit-model').value;
            myEV.range_km = parseFloat(document.getElementById('edit-range').value);
            currentUser.current_battery = parseFloat(document.getElementById('edit-battery').value);
            localStorage.setItem('myEV', JSON.stringify(myEV));
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            document.getElementById('status-car-name').textContent = `🚗 ${myEV.brand} ${myEV.model}`;
            document.getElementById('status-battery').textContent = `${currentUser.current_battery}%`;
            closeProfileModal();
        }
        function goToProfile() { window.location.href = "/profile"; }
        function openGoogleMaps() {
            if (!tripOrigin || !tripDestination) return;
            window.open(`https://www.google.com/maps/dir/?api=1&origin=${tripOrigin.lat},${tripOrigin.lng}&destination=${tripDestination.lat},${tripDestination.lng}&travelmode=driving`, '_blank');
        }
        function logout() {
            if (confirm("คุณต้องการออกจากระบบใช่หรือไม่?")) {
                localStorage.removeItem('currentUser');
                window.location.href = "/login";
            }
        }
        
        const evDatabase = {
            "BYD": [
                { model: "Atto 3 Extended", range: 480 },
                { model: "Atto 3 Standard", range: 410 },
                { model: "Dolphin Extended", range: 490 },
                { model: "Seal Performance", range: 580 },
                { model: "Seal Dynamic/Premium", range: 650 }
            ],
            "Tesla": [
                { model: "Model Y Rear-Wheel Drive", range: 455 },
                { model: "Model Y Long Range", range: 533 },
                { model: "Model 3 Rear-Wheel Drive", range: 513 },
                { model: "Model 3 Long Range", range: 629 }
            ],
            "MG": [
                { model: "MG4 Electric Standard", range: 350 },
                { model: "MG4 Electric Long Range", range: 540 },
                { model: "MG ZS EV", range: 403 },
                { model: "MG MAXUS 7", range: 480 }
            ],
            "GWM / Ora": [
                { model: "Ora Good Cat 400 PRO", range: 400 },
                { model: "Ora Good Cat 500 ULTRA", range: 500 },
                { model: "Ora 07 Performance", range: 550 }
            ],
            "Neta": [
                { model: "Neta V / V-II", range: 384 },
                { model: "Neta X", range: 480 }
            ],
            "AION": [
                { model: "AION Y Plus 490", range: 490 },
                { model: "AION Y Plus 580", range: 580 },
                { model: "AION ES", range: 442 }
            ],
            "Volvo": [
                { model: "EX30 Single Motor Extended", range: 480 },
                { model: "XC40 Recharge Twin", range: 500 },
                { model: "C40 Recharge Twin", range: 507 }
            ],
            "BMW": [
                { model: "iX3 M Sport", range: 460 },
                { model: "i4 eDrive35", range: 483 },
                { model: "iX xDrive40", range: 425 }
            ],
            "Porsche": [
                { model: "Taycan 4S", range: 512 },
                { model: "Taycan Turbo", range: 557 }
            ],
            "Audi": [
                { model: "Q8 e-tron 50", range: 491 },
                { model: "e-tron GT", range: 528 }
            ]
        };

        function loadBrandsToMap() {
            const brandSelect = document.getElementById('edit-brand');
            brandSelect.innerHTML = '<option value="">-- เลือกยี่ห้อรถ --</option>';

            Object.keys(evDatabase).forEach(brand => {
                const option = document.createElement('option');
                option.value = brand;
                option.textContent = brand;
                brandSelect.appendChild(option);
            });
        }

        document.getElementById('edit-brand').addEventListener('change', function () {
            const selectedBrand = this.value;
            const modelSelect = document.getElementById('edit-model');

            modelSelect.innerHTML = '<option value="">-- เลือกรุ่นรถ --</option>';
            document.getElementById('edit-range').value = '';

            if (selectedBrand && evDatabase[selectedBrand]) {
                evDatabase[selectedBrand].forEach(car => {
                    const option = document.createElement('option');
                    option.value = car.model;
                    option.textContent = car.model;
                    option.setAttribute('data-range', car.range);
                    modelSelect.appendChild(option);
                });
            }
        });

        document.getElementById('edit-model').addEventListener('change', function () {
            const selectedOption = this.options[this.selectedIndex];
            const range = selectedOption.getAttribute('data-range');

            if (range) {
                document.getElementById('edit-range').value = range;
            } else {
                document.getElementById('edit-range').value = '';
            }
        });

        document.getElementById('user-status').addEventListener('click', function () {
            document.getElementById('profile-modal').style.display = 'flex';

            const brandSelect = document.getElementById('edit-brand');
            brandSelect.value = myEV.brand || '';

            brandSelect.dispatchEvent(new Event('change'));

            setTimeout(() => {
                document.getElementById('edit-model').value = myEV.model || '';
                document.getElementById('edit-range').value = myEV.range_km || '';
                document.getElementById('edit-battery').value = currentUser.current_battery || 100;
            }, 50);
        });

        loadBrandsToMap();

        // ==========================================
        // ระบบประวัติการเดินทาง (Trip History)
        // ==========================================

        function openHistoryModal() {
            document.getElementById('history-modal').style.display = 'flex';
            loadHistory();
        }

        function closeHistoryModal() {
            document.getElementById('history-modal').style.display = 'none';
        }

        async function loadHistory() {
            const listDiv = document.getElementById('history-list');
            const username = currentUser.username !== 'Guest' ? currentUser.username : null;

            if (!username) {
                listDiv.innerHTML = '<p style="text-align: center; color: #ef4444; font-weight: bold;">กรุณาล็อกอินก่อนดูประวัติ</p>';
                return;
            }

            try {
                const response = await fetch(`/api/history?username=${username}`);
                const data = await response.json();

                if (data.history && data.history.length > 0) {
                    listDiv.innerHTML = '';
                    data.history.forEach((trip, index) => {
                        const date = new Date(trip.created_at).toLocaleString('th-TH');

                        const item = document.createElement('div');
                        item.style.cssText = 'padding: 10px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 10px; cursor: pointer; background: #f9fafb;';
                        item.innerHTML = `
                            <div style="font-weight: bold; color: #1f2937; font-size: 14px;">📍 ${trip.destination_name || 'จุดหมายที่ ' + (index + 1)}</div>
                            <div style="font-size: 11px; color: #6b7280; margin-top: 5px;">🕒 ${date}</div>
                            <button style="margin-top: 8px; width: 100%; background: #10b981; color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 12px;">🚀 ใช้เส้นทางนี้อีกครั้ง</button>
                        `;

                        item.onclick = () => reuseTrip(trip.start_lat, trip.start_lng, trip.end_lat, trip.end_lng, trip.destination_name);
                        listDiv.appendChild(item);
                    });
                } else {
                    listDiv.innerHTML = '<p style="text-align: center; color: #666; font-size: 13px;">ยังไม่มีประวัติการเดินทาง</p>';
                }
            } catch (error) {
                console.error("Load history error:", error);
                listDiv.innerHTML = '<p style="text-align: center; color: red;">โหลดข้อมูลล้มเหลว</p>';
            }
        }

        function reuseTrip(startLat, startLng, endLat, endLng, destinationName) {
            closeHistoryModal();

            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = destinationName || 'พิกัดประวัติการเดินทาง';

            userLocation = L.latLng(startLat, startLng);
            calculateAndDisplayRoute(L.latLng(endLat, endLng));
        }

        async function saveTripHistory(startLat, startLng, endLat, endLng, destName) {
            const username = currentUser.username !== 'Guest' ? currentUser.username : null;
            if (!username) return;

            try {
                await fetch('/api/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: username,
                        destination_name: destName,
                        start_lat: startLat,
                        start_lng: startLng,
                        end_lat: endLat,
                        end_lng: endLng
                    })
                });
            } catch (error) {
                console.error("Failed to save trip:", error);
            }
        }

    document.addEventListener('DOMContentLoaded', function() {
    // ล็อก Form ทั้งหมดไม่ให้รีเฟรชหน้า
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
        });
    });
});

// อัปเดตฟังก์ชันดักจับปุ่ม Enter ในช่องค้นหาให้ล็อกการรีเฟรช
function handleSearchKey(event) { 
    if (event.key === 'Enter') {
        event.preventDefault(); // ป้องกันหน้าเว็บกระพริบ
        searchLocation(); 
    }
}