# Environment Setup Guide

## Setting up Environment Variables

### 1. Create .env file
Copy the example environment file and customize it for your setup:

```bash
cp env.example .env
```

### 2. Configure Database
Edit the `.env` file and update the database configuration:

```env
# Database Configuration
DATABASE_URL=postgresql+psycopg2://postgres:your_password@localhost/EmiratesCo_Database

# Database Connection Settings
DB_HOST=localhost
DB_PORT=5432
DB_NAME=EmiratesCo_Database
DB_USER=postgres
DB_PASSWORD=your_password
```

### 3. Configure Application Settings
Update other settings as needed:

```env
# Application Settings
DEBUG=True
SECRET_KEY=your-secret-key-here-change-in-production
ENVIRONMENT=development

# API Settings
API_HOST=0.0.0.0
API_PORT=8000
```

### 4. Install Dependencies
Make sure to install the required packages:

```bash
pip install -r requirements.txt
```

### 5. Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Complete database connection string | `postgresql+psycopg2://postgres:21589596@localhost/EmiratesCo_Database` |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `EmiratesCo_Database` |
| `DB_USER` | Database username | `postgres` |
| `DB_PASSWORD` | Database password | `21589596` |
| `DEBUG` | Enable debug mode | `True` |
| `SECRET_KEY` | Secret key for security | `your-secret-key-here-change-in-production` |
| `ENVIRONMENT` | Environment name | `development` |
| `API_HOST` | API server host | `0.0.0.0` |
| `API_PORT` | API server port | `8000` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:3000,http://127.0.0.1:3000` |

### 6. Security Notes

- **Never commit `.env` files to version control**
- Change default passwords and secret keys in production
- Use strong, unique secret keys
- Consider using environment-specific `.env` files (`.env.development`, `.env.production`)

### 7. Production Considerations

For production deployment:
- Set `DEBUG=False`
- Use strong, randomly generated `SECRET_KEY`
- Set `ENVIRONMENT=production`
- Use secure database credentials
- Configure proper CORS origins
- Set up proper logging levels
