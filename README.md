# CrawlJob Studio v2.0 — Universal Job Crawler & BI Studio (20 Job Portals)

Hệ thống thu thập, chuẩn hóa và phân tích việc làm đa sàn lấy cảm hứng từ **n8n Visual Workflow Pipeline**, hỗ trợ đóng gói thành ứng dụng Desktop độc lập (`CrawlJobStudio.exe`) không hiện cửa sổ Console.

## Tính năng nổi bật
1. **Hỗ trợ đồng thời 20 Sàn Tuyển Dụng lớn tại Việt Nam & Quốc tế:**
   - `ITviec`, `TopCV`, `VietnamWorks`, `CareerViet`, `CareerLink`, `Glints`, `TopDev`, `Vieclam24h`, `JobsGO`, `ViecOi`, `Joboko`, `123Job`, `JoyWork`, `CVWork`, `XemViec`, `Devwork`, `IconicJob`, `Indeed VN`, `LinkedIn`, `RemoteOK`.
2. **Kiến trúc 6 Nodes Pipeline trực quan (Real-time SSE):**
   - **Node 1 – Input & Discovery:** Hỗ trợ Single URL, Bulk URLs và Multi-Site Keyword Search trên 20 sàn tuyển dụng.
   - **Node 2 – Multi-Tier Bypass Fetcher:** Kết hợp Fast TLS Impersonation (`Tier 1`) ➔ Shared Headless Chrome CDP Pool + XHR/GraphQL Sniffer (`Tier 2`) ➔ Anti-Bot Challenge & Cloudflare Turnstile Guard.
   - **Node 3 – Network & State Sniffer:** Bóc tách `application/ld+json` (`JobPosting`), Next.js `__NEXT_DATA__`, Nuxt `__NUXT__`, Indeed `window.mosaic.providerData`, và chuyển đổi HTML sang Clean Markdown.
   - **Node 4 – Domain Recipe & AI Self-Healing Extractor:** Dùng bộ Selector Recipe chuyên biệt cho từng sàn kết hợp AI Self-Healing (**Gemini, OpenAI, Groq, OpenRouter, Ollama**) và Smart Heuristic Fallback.
   - **Node 5 – 2-Phase Deep Crawl Queue:** Pha 1 trả kết quả ngay lập tức; Pha 2 chạy ngầm lấy toàn bộ JD Offline (Markdown), Kỹ năng, JLPT và thông tin liên hệ HR (`Email`, `SĐT`, `Tên HR`).
   - **Node 6 – Filter, Dedup & Sink:** Lọc `Company Blacklist`, `Excluded Keywords`, `Whitelist Highlight`, chuẩn hóa mức lương (`VND`/`USD`/`JPY` ➔ Triệu VNĐ/tháng), xuất **Excel (`.xlsx` đa Sheet) / CSV**.
3. **Giao diện Bảng Kết Quả & BI Analytics hiện đại:**
   - **Chế độ Xem Đôi (Split-View Master-Detail):** Cuộn độc lập giữa Bảng Kết Quả bên trái và Trình đọc JD Offline bên phải.
   - **Infinite Scroll 60fps:** Tự động nạp thêm việc làm khi cuộn, tự đưa về đầu bảng khi đổi Sheet/Bộ lọc, và highlight rõ nét dòng đang xem JD / đã xem JD.
   - **Thống Kê BI (4 Bảng Phân Tích Chuyên Sâu):** Phân bổ theo Sàn, Khung Lương, Nhóm Ngành và Kỹ Năng/Khu Vực kèm tính năng Click-to-Filter.

---

## Hướng dẫn chạy & Đóng gói

### 1. Chạy trực tiếp bằng Bun (Development)
```powershell
# Cài đặt thư viện Frontend
bun install --cwd frontend

# Build giao diện React & nhúng vào Server
bun run --cwd frontend build
bun run scripts/embed-dist.ts

# Khởi chạy ứng dụng
bun run server/standalone.ts
```

### 2. Đóng gói file thực thi `CrawlJobStudio.exe` (Zero Console Window)
```powershell
bun run scripts/build-exe.ts
```
Sau khi biên dịch, mở trực tiếp `CrawlJobStudio.exe` để khởi chạy ứng dụng Desktop.
