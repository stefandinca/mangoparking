# Mango Parking
## Long-Term & Commuter Parking — Otopeni Airport
### Design & Implementation Brief

---

## Role

Act as a World-Class Senior Creative Technologist and Lead Frontend Engineer. You build high-fidelity, cinematic "1:1 Pixel Perfect" website pages. Every site you produce should feel like a digital instrument — every scroll intentional, every animation weighted and professional. Eradicate all generic AI patterns.

---

## 1. Project Overview

Mango Parking is a long-term parking facility located near Henri Coandă International Airport (Otopeni), Romania. The system serves two distinct customer segments and an internal operations team:

**Travelers (Long-Term Parking)**
People flying out for holiday or business who need secure, affordable parking for days or weeks at a time.

**Commuters (Subscription Parking)**
Daily commuters who use the nearby train station. They park Mon–Fri (6:00 AM – 8:00 PM) and pay a flat monthly subscription.

**Staff (Admin Panel)**
Manage bookings, capacity, pricing, shuttle schedules, and monitor operations in real time.

### Key Differentiator
No competitor near Otopeni targets commuters. Mango Parking is the first to serve both travelers and daily train commuters with a single facility and shared shuttle service.

### Desired Brand Feel
Clean. Slick. Utilitarian. No bells and whistles. Fast, snappy, not crowded, easy to navigate. The site should feel like a well-designed utility — trustworthy, efficient, zero friction.

---

## 2. Brand Identity

### Proposed Taglines (Pick One)
- **Mango Parking — Park. Fly. Relax.**
- **Mango Parking — Your Spot Is Waiting.**
- **Mango Parking — Park Smart. Travel Easy.**

### Color Palette

| Name         | Hex       | Usage                                      |
|--------------|-----------|---------------------------------------------|
| Mango Orange | `#F28C28` | Primary brand color, CTAs, accents          |
| Leaf Green   | `#4CAF50` | Availability indicators, success states     |
| Mango Red    | `#D94F3B` | Alerts, full capacity, urgency signals      |
| Charcoal     | `#1E1E1E` | Body text, dark backgrounds                 |
| Warm White   | `#FAF8F5` | Page backgrounds, cards                     |
| Slate Gray   | `#64748B` | Secondary text, borders, muted elements     |

### Typography
- **Headings:** Inter (Bold / Semi-Bold)
- **Body:** Inter (Regular / Medium)
- **Monospace (data/codes):** JetBrains Mono

### Design Principles
- Mobile-first responsive design
- No decorative clutter — every element earns its place
- High contrast for outdoor/mobile readability
- Animations limited to purposeful micro-interactions (loading states, transitions, confirmations)

---

## 3. Tech Stack

| Layer      | Technology                          |
|------------|--------------------------------------|
| Frontend   | HTML, TailwindCSS, Vite              |
| Backend    | Firebase (Auth, Firestore, Hosting)   |
| Languages  | Romanian + English (i18n)             |
| SEO        | Priority — organic search is critical |

---

## 4. Scope & Phasing

### Phase 1 (Required for Launch)
- Public website with all sections
- Online booking (date picker, pay on arrival)
- Commuter subscription sign-up flow
- Real-time capacity display (110 spots)
- Live shuttle timetable
- Train schedule + popular flight display (mock data)
- Admin panel (bookings, capacity, pricing, shuttle, audit)
- Firebase authentication (Google + email/password)
- SEO optimization for "parking Otopeni", "parcare aeroport", etc.
- Mock reviews and testimonials
- Romanian + English language support

### Phase 2 (Future)
- Online payment integration (Stripe or local processor)
- Email/SMS booking confirmations
- Staff push notifications (capacity alerts)
- SMS/WhatsApp shuttle ETA notifications
- Flight delay detection + auto shuttle adjustment
- POS integration
- Corporate accounts for commuter subscriptions

### Explicitly Out of Scope (Phase 1)
- Native mobile app
- Live payment processing
- Customer SMS/email notifications
- Barcode/QR gate automation

---

## 5. Sitemap

```
/                         → Home (Landing Page)
/booking                  → Booking Flow (Date Picker + Subscription Option)
/pricing                  → Pricing Plans (Traveler + Commuter)
/shuttle                  → Shuttle Schedule (Live Timetable + Train/Flight Sync)
/commuter                 → Commuter Plan (Dedicated Landing Page)
/about                    → About Us (Story, Security, Amenities)
/contact                  → Contact (Form, Map, Directions)
/account                  → Customer Dashboard (Auth Required)
/account/bookings         → Booking History
/account/subscription     → Subscription Management
/account/vehicles         → Saved Vehicles
/account/loyalty          → Loyalty Points
/admin                    → Admin Dashboard (Staff Auth Required)
/admin/bookings           → Manage Bookings
/admin/capacity           → Capacity Management
/admin/pricing            → Pricing Editor
/admin/shuttle            → Shuttle Schedule Manager
/admin/reports            → Revenue & Occupancy Reports
/admin/audit              → Audit Log
```

---

## 6. Public Website — Page Requirements

### 6A. Home / Landing Page

**Hero Section**
- Bold headline communicating the value proposition
- Real-time capacity widget: **"X spots available"** (pulls from Firebase)
- Two clear CTAs:
  - "Book Your Spot" → `/booking`
  - "Commuter Plan" → `/commuter`
- Background: clean, high-quality image or subtle animation of the parking facility

**How It Works**
- 3-step visual strip:
  1. **Book** — Reserve your spot online
  2. **Park** — Drop off your car, take the free shuttle
  3. **Fly** — We watch your car, you enjoy your trip

**Pricing Preview**
- Summary cards for Traveler and Commuter plans
- "See All Plans" link → `/pricing`

**Amenities**
- Icon-based grid:
  - Free shuttle to airport & train station
  - 24/7 security & CCTV
  - Car wash service
  - EV charging
  - Covered parking available
  - Luggage assistance

**Shuttle Schedule Preview**
- Mini live timetable: last shuttle departure, next shuttle departure
- Link to full schedule → `/shuttle`

**Testimonials / Reviews**
- Carousel or grid of customer reviews (mock data for Phase 1)
- Star ratings, names, travel type

**FAQ**
- Collapsible accordion
- Common questions: security, shuttle frequency, what happens if flight is delayed, cancellation policy, subscription terms

**Map & Directions**
- Embedded Google Maps with location pin
- One-tap "Get Directions" button (opens Google Maps / Waze)
- Address, phone, email

**SEO Requirements**
- Semantic HTML with proper heading hierarchy
- Schema.org structured data (LocalBusiness, ParkingFacility)
- Meta descriptions in both RO and EN
- Target keywords: "parcare otopeni", "parking aeroport otopeni", "parcare lunga durata otopeni", "parking near otopeni airport"

---

### 6B. Booking Flow (`/booking`)

**Booking Type Selection**
- Toggle or tab: **Traveler** | **Commuter**

**Traveler Booking**
- Date & time picker:
  - Drop-off date + time
  - Pick-up date + time
- Auto-calculate duration and price
- Vehicle info: License plate, make/model (optional)
- Contact info: Name, phone, email
- Summary card showing:
  - Dates, duration, estimated price
  - Available amenities (car wash add-on, covered spot upgrade)
- Confirmation: "Reserve — Pay on Arrival"
- Booking confirmation screen with booking code

**Commuter Subscription**
- Monthly subscription sign-up
- Select start month
- Vehicle info: License plate, make/model
- Contact info
- Terms: Mon–Fri, 6:00 AM – 8:00 PM
- Confirmation: "Subscribe — Pay on Arrival"

**UX Requirements**
- No page reloads — single-page flow
- Real-time price calculation as dates change
- Show remaining capacity inline
- If full → show waitlist option or "notify me" email capture
- Mobile-optimized date/time pickers

---

### 6C. Pricing Page (`/pricing`)

**Traveler Pricing**
- Tiered pricing table (admin-editable values from Firebase):
  - 1–3 days
  - 4–7 days
  - 8–14 days
  - 15–30 days
  - 30+ days
- Add-ons: Car wash, covered parking, EV charging

**Commuter Pricing**
- Flat monthly rate
- Comparison with daily parking cost to show value
- Terms summary (Mon–Fri, 6 AM – 8 PM)

**Design**
- Clean comparison cards
- Highlight "most popular" or "best value" plan
- CTA on every card → booking flow

---

### 6D. Shuttle Schedule (`/shuttle`)

**Live Shuttle Timetable**
- Shows:
  - Last shuttle departure time + destination
  - Next shuttle departure time + destination
  - Upcoming 3–5 departures
- Routes:
  - Parking → Airport Terminal
  - Parking → Train Station
  - Airport → Parking
  - Train Station → Parking
- Status indicators: "Departed", "Boarding", "Next"

**Train Schedule Integration**
- Display next 3–5 train departures from the nearby station
- Sourced from public schedule (mock data for Phase 1)

**Popular Flights Today**
- Display 2–3 popular departing flights for context
- Mock data for Phase 1

**Design**
- Tabular, scannable layout
- Auto-refresh every 60 seconds
- Mobile: card-based stacked view

---

### 6E. Commuter Landing Page (`/commuter`)

**Dedicated page targeting the commuter audience:**
- Headline emphasizing the unique value: "The only commuter parking at Otopeni"
- Benefits strip:
  - Flat monthly rate
  - Free shuttle to train station, synced with schedule
  - Guaranteed spot Mon–Fri
  - 24/7 security
- Pricing card with CTA
- "How It Works" for commuters specifically
- FAQ specific to subscription terms

---

### 6F. About Page (`/about`)

- Company story / mission
- Security highlights (24/7 staff, CCTV, gated entry)
- Facility photos (placeholder for Phase 1)
- Amenities detail
- Team (optional)

---

### 6G. Contact Page (`/contact`)

- Contact form (name, email, subject, message) → Firebase or email service
- Google Maps embed with directions
- Phone number, email address
- Operating hours

---

## 7. Customer Account (`/account`)

Authenticated area for registered customers (login via Google or email/password).

### Dashboard
- Active booking summary or active subscription status
- Next shuttle time
- Quick re-book button (pre-fills last booking details)

### Booking History
- List of past and upcoming bookings
- Status: Upcoming, Active, Completed, Cancelled
- Booking code, dates, vehicle, price

### Subscription Management
- Current plan status (Active / Expired / Pending)
- Renewal date
- Option to cancel or pause

### Saved Vehicles
- List of registered vehicles (license plate, make, model)
- Set default vehicle
- Add / remove vehicles

### Loyalty Program
- Points balance
- Points history (earned per booking)
- Reward tiers:
  - Bronze: 0–499 points
  - Silver: 500–999 points (5% discount)
  - Gold: 1000+ points (10% discount + free car wash)
- "Where's My Car?" widget:
  - Enter booking code or license plate
  - Shows parking zone/spot assignment

---

## 8. Admin Panel (`/admin`)

### Design Direction
- Utility-first, table-based views
- Optimized for speed and clarity
- Minimal branding — functional over decorative
- Responsive but desktop-optimized

### Authentication
- Google account or email/password via Firebase Auth
- Role-based: Admin, Staff (read-only for certain sections)

### 8A. Dashboard (`/admin`)
- Today's overview:
  - Total spots: 110
  - Occupied / Available (real-time)
  - Today's check-ins / check-outs
  - Active subscriptions count
  - Revenue today / this week / this month
- Capacity alert: visual warning when >90% full
- Quick actions: Check in, Check out, New booking

### 8B. Booking Management (`/admin/bookings`)
- Table view of all bookings
- Filters: Status, Date range, Type (Traveler / Commuter)
- Search by: Name, License plate, Booking code, Phone
- Actions per booking:
  - View details
  - Check in (records timestamp, license plate, spot assignment)
  - Check out (records timestamp)
  - Cancel
  - Edit
- Photo check-in: Staff can upload a photo of the vehicle at drop-off for damage protection

### 8C. Capacity Management (`/admin/capacity`)
- Visual grid or map of parking spots
- Real-time status per spot: Available, Occupied, Reserved, Maintenance
- Total capacity setting (editable)
- Spot assignment on check-in

### 8D. Pricing Editor (`/admin/pricing`)
- Edit all pricing tiers (Traveler)
- Edit subscription rate (Commuter)
- Edit add-on prices (car wash, covered, EV)
- Changes reflect immediately on the public site
- History of pricing changes (audit trail)

### 8E. Shuttle Management (`/admin/shuttle`)
- Edit shuttle schedule (departure times, routes)
- Mark shuttles as departed / delayed / cancelled
- View upcoming departures
- Edit train schedule display
- Edit featured flights

### 8F. Revenue & Reports (`/admin/reports`)
- Revenue breakdown: Daily, Weekly, Monthly
- Revenue by type: Traveler vs. Commuter
- Occupancy trends over time (chart)
- Booking volume trends (chart)
- Export to CSV / spreadsheet

### 8G. Audit Log (`/admin/audit`)
Every significant action must be logged:
- Booking created / modified / cancelled
- Check-in / check-out
- Pricing changed
- Capacity changed
- Shuttle schedule modified

Each log entry records:
- Action type
- Entity affected (booking ID, spot ID, etc.)
- Old value → New value
- Staff user
- Timestamp

Audit logs are viewable:
- Globally (all actions)
- Per booking
- Per staff member
- Filterable by date range and action type

---

## 9. Feature Specifications

### 9A. Real-Time Capacity Widget
- Displayed on homepage hero section
- Shows: "X of 110 spots available"
- Visual progress bar (green → orange → red as capacity fills)
- Updates in real time via Firebase listener
- Creates urgency when spots are low

### 9B. "Where's My Car?" Helper
- Available in customer account dashboard
- Input: Booking code or license plate
- Output: Parking zone, spot number, check-in photo (if available)
- Useful for returning travelers who forgot where they parked

### 9C. Quick Re-Book
- Available in customer account dashboard
- Pre-fills: same vehicle, same parking type, same add-ons
- Customer only needs to set new dates
- One-click flow for repeat customers

### 9D. Loyalty Program
- 1 point per day parked (Traveler)
- 10 points per month (Commuter subscription)
- Rewards unlock automatically at tier thresholds
- Admin can manually adjust points
- Points display in customer dashboard

### 9E. Flight Delay Detection (Phase 2)
- Customer optionally enters flight number at booking
- System checks flight status via API (mock for Phase 1)
- If delayed: auto-notify shuttle team, adjust pickup schedule
- Customer sees updated shuttle time in their dashboard

### 9F. Google Maps Integration
- Embedded map on homepage and contact page
- "Get Directions" button opens native maps app
- One-tap navigation from any page via floating action button (mobile)

### 9G. Photo Check-In
- Staff uploads 2–4 photos of vehicle at drop-off
- Photos attached to booking record
- Viewable by both staff and customer
- Serves as damage protection documentation

---

## 10. SEO Strategy

### Target Keywords (RO)
- parcare otopeni
- parcare aeroport otopeni
- parcare lunga durata otopeni
- parcare langa aeroport henri coanda
- parcare naveta aeroport
- abonament parcare otopeni

### Target Keywords (EN)
- otopeni airport parking
- long term parking otopeni
- parking near bucharest airport
- airport parking with shuttle
- commuter parking otopeni

### Technical SEO
- Semantic HTML5 with proper heading hierarchy
- Schema.org structured data: `ParkingFacility`, `LocalBusiness`
- Open Graph + Twitter Card meta tags
- Sitemap.xml + robots.txt
- Fast load times (<2s) — critical for mobile SEO
- Lazy loading for images
- Alt text on all images
- Canonical URLs for RO/EN versions

---

## 11. Internationalization (i18n)

- All user-facing strings stored in locale files (RO + EN)
- Language toggle in header/nav
- URL structure: `/en/booking`, `/ro/booking` or query param `?lang=en`
- Default language: Romanian
- Admin panel: English only (or bilingual, lower priority)

---

## 12. Future Considerations (Not Required Now)

- Online payment (Stripe / local processor)
- Customer email/SMS notifications
- SMS/WhatsApp shuttle ETA
- Corporate accounts (companies managing multiple commuter subscriptions)
- Native mobile app
- Barcode/QR gate automation
- POS integration
- Advanced flight delay detection via live API

The system should be architected so these can be added later without refactoring the core data model.

---

## 13. Final Instruction

When in doubt, default to:
**Fewer clicks, instant feedback, and visible state changes.**

If a feature is ambiguous, clarity and usability take precedence over complexity. The site must convert visitors into bookings — every design decision should reduce friction between "I need parking" and "I have a reservation."
