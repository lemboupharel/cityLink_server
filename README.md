# CityLink 2.1 Backend API

Complete Node.js/Express backend for CityLink 2.1 with strict separation between Recycling (Money Path) and Dump Reporting (Data Path) modules.

## 🏗️ Architecture

### Core Principles
- **CityLink never pays for information** - only for recovered value
- **Strict module separation** - Recycling and Dump Reporting are completely independent
- **Role-based access control** - CITIZEN, COLLECTOR, AGENCY, MUNICIPAL

### Modules

#### ♻️ Recycling Module (Money Path)
- Waste types: PET, ALUMINUM, HDPE only
- Payment split: Collector 50%, Citizen 20%, CityLink 30%
- Workflow: Declaration → Pickup → Agency Validation → Payment

#### 🚨 Dump Reporting Module (Data Path)
- **NO payments** - only reputation scoring
- Multi-user verification required (≥2 different users)
- Photo hashing to prevent fraud
- Geo-clustering for nearby reports (within 100m)

#### 📊 Municipal Dashboard
- Read-only access for MUNICIPAL role
- Heatmap data, density analytics
- Verified dumps only

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18
- Docker and Docker Compose
- npm >= 9

### Installation

1. **Clone and navigate to server directory**
```bash
cd /path/to/CityLink/server
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.template .env
# Edit .env with your configuration
```

4. **Start PostgreSQL with Docker**
```bash
docker-compose up -d postgres
```

5. **Run database migrations**
```bash
npx prisma migrate dev --name init
npx prisma generate
```

6. **Start development server**
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## 🐳 Docker Deployment

### Full Stack (PostgreSQL + API)

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop all services
docker-compose down
```

### Database Only

```bash
# Start PostgreSQL only
docker-compose up -d postgres

# Access PostgreSQL
docker exec -it citylink_postgres psql -U citylink -d citylink_db
```

## 📚 API Documentation

### Authentication

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "phone": "237612345678",
  "password": "secure_password",
  "role": "CITIZEN",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Roles:** `CITIZEN`, `COLLECTOR`, `AGENCY`, `MUNICIPAL`

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "phone": "237612345678",
  "password": "secure_password"
}
```

**Returns:** JWT token (expires in 100 years as specified)

### Recycling Module (Money Path)

#### Declare Waste (CITIZEN only)
```http
POST /api/recycling/declare
Authorization: Bearer {token}
Content-Type: application/json

{
  "wasteType": "PET",
  "estimatedKg": 5.5,
  "latitude": 3.8480,
  "longitude": 11.5021,
  "description": "5 large PET bottles"
}
```

**Waste Types:** `PET`, `ALUMINUM`, `HDPE`

#### Confirm Pickup (COLLECTOR only)
```http
POST /api/recycling/pickup/{declarationId}
Authorization: Bearer {token}
Content-Type: application/json

{
  "notes": "Picked up at 10:00 AM"
}
```

#### Validate Weight (AGENCY only)
```http
POST /api/recycling/validate/{declarationId}
Authorization: Bearer {token}
Content-Type: application/json

{
  "confirmedKg": 5.2,
  "notes": "Weight confirmed"
}
```

**Payment automatically calculated:**
- Collector: 50%
- Citizen: 20%
- CityLink: 30%

#### Get Declarations
```http
GET /api/recycling/declarations?status=PENDING
Authorization: Bearer {token}
```

#### Get Wallet Balance
```http
GET /api/recycling/wallet
Authorization: Bearer {token}
```

### Dump Reporting Module (Data Path)

#### Report Dump (All authenticated users)
```http
POST /api/dumps/report
Authorization: Bearer {token}
Content-Type: application/json

{
  "latitude": 3.8480,
  "longitude": 11.5021,
  "photoBase64": "data:image/jpeg;base64,/9j/4AAQ...",
  "size": "MEDIUM",
  "description": "Roadside dump near market"
}
```

**Sizes:** `SMALL`, `MEDIUM`, `LARGE`

**Verification Logic:**
- Report created as UNVERIFIED
- If another user reports within 100m → both become VERIFIED
- Requires ≥2 different users
- Reputation points awarded only for VERIFIED dumps

#### Get Dumps
```http
GET /api/dumps?status=VERIFIED&myReports=true
Authorization: Bearer {token}
```

#### Get User Reputation
```http
GET /api/dumps/user/reputation
Authorization: Bearer {token}
```

### Municipal Dashboard (MUNICIPAL only)

#### Heatmap Data
```http
GET /api/municipal/heatmap?startDate=2026-01-01&endDate=2026-12-31
Authorization: Bearer {token}
```

#### Density Analytics
```http
GET /api/municipal/density?gridSize=0.01
Authorization: Bearer {token}
```

#### Verified Dumps
```http
GET /api/municipal/dumps?size=LARGE&startDate=2026-01-01
Authorization: Bearer {token}
```

## 🗄️ Database Schema

### User Management
- `users` - User accounts with role
- `profiles` - Extended user information

### Recycling Module
- `waste_declarations` - Citizen waste submissions
- `collections` - Collector pickup records
- `agency_confirmations` - Weight validations
- `recycling_transactions` - Payment calculations
- `wallets` - User balances
- `payouts` - Withdrawal records

### Dump Reporting Module
- `dump_reports` - Illegal dump submissions
- `dump_verifications` - Multi-user verifications
- `reputation_scores` - User reputation tracking
- `photo_hashes` - Photo fraud prevention

### Anti-Fraud
- `report_flags` - Flagged suspicious reports

## 🧪 Testing

### Using REST Client (VS Code Extension)

1. Install **REST Client** extension
2. Open `test.rest`
3. Click "Send Request" above each request

### Manual Testing Flow

1. **Register 4 users** (one for each role)
2. **CITIZEN declares waste**
3. **COLLECTOR picks up**
4. **AGENCY validates** → verify payment split
5. **Two users report dump** → verify multi-user verification
6. **MUNICIPAL views** → verify read-only access

## 🔒 Security

- JWT authentication (100-year expiration as specified)
- Password hashing with bcrypt
- Role-based authorization
- Photo hash deduplication
- No shared wallet between modules

## 📁 Project Structure

```
server/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── controllers/           # Business logic
│   │   ├── auth.controller.ts
│   │   ├── recycling.controller.ts
│   │   ├── dumps.controller.ts
│   │   └── municipal.controller.ts
│   ├── routes/                # API routes
│   │   ├── auth.routes.ts
│   │   ├── recycling.routes.ts
│   │   ├── dumps.routes.ts
│   │   └── municipal.routes.ts
│   ├── middleware/            # Auth middleware
│   │   └── auth.ts
│   ├── utils/                 # Utilities
│   │   ├── photoHash.ts
│   │   └── geoUtils.ts
│   └── index.ts               # App entry point
├── docker-compose.yml         # Docker orchestration
├── Dockerfile                 # Container build
├── .env.template              # Environment template
├── test.rest                  # API tests
└── package.json               # Dependencies
```

## 🔧 Environment Variables

See `.env.template` for all available configuration options.

**Critical Settings:**
- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - Secret for token signing
- `JWT_EXPIRATION` - Token lifetime (default: 876000h = 100 years)
- `GEO_CLUSTER_RADIUS` - Meters for dump clustering (default: 100)
- `COLLECTOR_PERCENTAGE` - Payment split (default: 50)
- `CITIZEN_PERCENTAGE` - Payment split (default: 20)
- `CITYLINK_PERCENTAGE` - Payment split (default: 30)

## 📊 Module Separation

**CRITICAL:** The two modules are completely separate:

| Feature | Recycling Module | Dump Reporting Module |
|---------|-----------------|----------------------|
| **Purpose** | Paid waste collection | Civic reporting |
| **Payment** | ✅ Yes (50/20/30 split) | ❌ No payments |
| **Wallet** | ✅ Shared by CITIZEN/COLLECTOR | ❌ None |
| **Points** | 💰 Money | ⭐ Reputation only |
| **Tables** | waste_declarations, wallets, transactions | dump_reports, reputation_scores |

**NO shared logic between modules.**

## 🚦 Development Workflow

```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Database operations
npx prisma studio          # Open Prisma Studio
npx prisma migrate dev     # Create migration
npx prisma migrate deploy  # Deploy migration
```

## 📝 License

MIT

## 👥 Support

For issues or questions, contact the CityLink team.
