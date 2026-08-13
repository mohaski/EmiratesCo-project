from sqlalchemy import create_engine, text
from db.database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("Checking 'mustChangePassword' column on 'users' table...")
        has_must_change = conn.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='mustChangePassword'"
        )).fetchone()
        if has_must_change:
            print("Column 'mustChangePassword' already exists.")
        else:
            has_first_login = conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='firstLogin'"
            )).fetchone()
            if has_first_login:
                print("Renaming 'firstLogin' column to 'mustChangePassword'...")
                conn.execute(text('ALTER TABLE users RENAME COLUMN "firstLogin" TO "mustChangePassword"'))
            else:
                print("Adding 'mustChangePassword' column to 'users' table...")
                conn.execute(text('ALTER TABLE users ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false'))
            conn.commit()
            print("Done.")

        print("Checking 'isActive' column on 'users' table...")
        has_is_active = conn.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='isActive'"
        )).fetchone()
        if has_is_active:
            print("Column 'isActive' already exists.")
        else:
            print("Adding 'isActive' column to 'users' table...")
            conn.execute(text('ALTER TABLE users ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true'))
            conn.commit()
            print("Done.")

if __name__ == "__main__":
    migrate()
