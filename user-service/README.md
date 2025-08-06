# User Service

A comprehensive, production-ready user management service built with Node.js, TypeScript, and Express. Features clean architecture, comprehensive testing, and Docker support.

## Features

- **User Management**: Complete CRUD operations for user accounts
- **Authentication**: JWT-based authentication with secure password hashing
- **Authorization**: Role-based access control (Admin, Moderator, User, Guest)
- **Validation**: Comprehensive input validation using Joi
- **Error Handling**: Centralized error handling with proper HTTP status codes
- **Logging**: Structured logging with Winston
- **Security**: Helmet, CORS, rate limiting, and security best practices
- **Testing**: Unit and integration tests with Jest
- **Docker**: Production-ready Docker configuration
- **Documentation**: Comprehensive API documentation

## Architecture

```
user-service/
├── src/
│   ├── config/         # Configuration management
│   ├── controllers/    # Request handlers
│   ├── middleware/     # Express middleware
│   ├── models/         # Data models
│   ├── repositories/   # Data access layer
│   ├── routes/         # API routes
│   ├── services/       # Business logic
│   ├── types/          # TypeScript types
│   ├── utils/          # Utility functions
│   ├── app.ts          # Express app setup
│   └── index.ts        # Server entry point
├── tests/
│   ├── unit/           # Unit tests
│   └── integration/    # Integration tests
├── docs/               # Additional documentation
├── scripts/            # Utility scripts
└── package.json        # Project dependencies
```

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Docker (optional)

### Installation

1. Clone the repository:
```bash
cd /workspaces/claude-code-flow/user-service
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run in development mode:
```bash
npm run dev
```

5. Run tests:
```bash
npm test
npm run test:coverage
```

6. Build for production:
```bash
npm run build
npm start
```

### Docker Deployment

1. Build and run with Docker Compose:
```bash
docker-compose up -d
```

2. Or build manually:
```bash
docker build -t user-service .
docker run -p 3000:3000 --env-file .env user-service
```

## API Documentation

### Authentication

All protected endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <token>
```

### Endpoints

#### Public Endpoints

**POST /api/register**
Register a new user
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe"
}
```

**POST /api/login**
Authenticate user
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

#### Protected Endpoints

**GET /api/profile**
Get current user profile
- Authentication: Required

**POST /api/change-password**
Change user password
- Authentication: Required
```json
{
  "oldPassword": "OldPass123!",
  "newPassword": "NewPass456!"
}
```

**POST /api/verify-email**
Verify user email
- Authentication: Required

**GET /api/users**
List all users (paginated)
- Authentication: Required
- Authorization: Admin, Moderator
- Query params: page, limit, sortBy, sortOrder, role, status, search

**GET /api/users/:id**
Get user by ID
- Authentication: Required
- Authorization: Owner or Admin

**PUT /api/users/:id**
Update user
- Authentication: Required
- Authorization: Owner or Admin
```json
{
  "firstName": "Updated",
  "lastName": "Name",
  "avatar": "https://example.com/avatar.jpg"
}
```

**DELETE /api/users/:id**
Delete user
- Authentication: Required
- Authorization: Admin
- Query params: soft (default: true)

**GET /api/users/stats**
Get user statistics
- Authentication: Required
- Authorization: Admin

### Response Format

Success Response:
```json
{
  "success": true,
  "data": {},
  "message": "Operation successful"
}
```

Error Response:
```json
{
  "success": false,
  "error": {
    "message": "Error description"
  }
}
```

Paginated Response:
```json
{
  "success": true,
  "data": [],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10
  }
}
```

## Configuration

Environment variables (see .env.example):

| Variable | Description | Default |
|----------|-------------|---------|
| NODE_ENV | Environment (development/production) | development |
| PORT | Server port | 3000 |
| HOST | Server host | localhost |
| JWT_SECRET | Secret key for JWT tokens | Required |
| JWT_EXPIRES_IN | Token expiration time | 24h |
| BCRYPT_ROUNDS | Password hashing rounds | 10 |
| LOG_LEVEL | Logging level | info |
| CORS_ORIGIN | CORS allowed origins | * |
| RATE_LIMIT_WINDOW_MS | Rate limit window | 900000 |
| RATE_LIMIT_MAX_REQUESTS | Max requests per window | 100 |

## Security Features

- Password hashing with bcrypt
- JWT token authentication
- Rate limiting
- CORS protection
- Helmet security headers
- Input validation
- SQL injection prevention
- XSS protection
- Environment variable validation

## Testing

Run all tests:
```bash
npm test
```

Run with coverage:
```bash
npm run test:coverage
```

Run in watch mode:
```bash
npm run test:watch
```

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run typecheck` - Type check with TypeScript

## User Roles

- **Admin**: Full system access
- **Moderator**: User management access
- **User**: Standard user access
- **Guest**: Limited access

## User Status

- **Active**: Normal user status
- **Inactive**: Temporarily inactive
- **Suspended**: Account suspended
- **Deleted**: Soft deleted

## Error Codes

- 400: Bad Request (validation error)
- 401: Unauthorized (authentication required)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 409: Conflict (duplicate resource)
- 500: Internal Server Error

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT

## Support

For issues and questions, please create an issue in the repository.