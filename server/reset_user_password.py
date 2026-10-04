"""Give an account a temporary password from the server machine — the recovery path for a
CEO (or anyone) locked out, now that admins can no longer reset admin/CEO accounts and the
app has no working "forgot password" email.

Run on the server, from server/:
    python reset_user_password.py <username>
    python reset_user_password.py <username> --db emiratesco_edit_test

Prints a random temporary password. The account is flagged to change it on next sign-in,
and is reactivated if it had been deactivated.
"""
import secrets
import string
import sys

from sqlmodel import Session, create_engine, select

import entities  # noqa: F401 - registers every table
from config import settings
from entities.users import User
from core.userManagement.authService import hash_password


def engine_for(db_name=None):
    url = settings.get_database_url()
    if db_name:
        base, _, _ = url.rpartition("/")
        url = f"{base}/{db_name}"
    return create_engine(url, echo=False)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(1)
    username = args[0]
    db_name = sys.argv[sys.argv.index("--db") + 1] if "--db" in sys.argv else None

    with Session(engine_for(db_name)) as db:
        user = db.exec(select(User).where(User.username == username)).first()
        if user is None:
            print(f"No account with username '{username}'.")
            sys.exit(1)
        temp = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(10))
        user.password = hash_password(temp)
        user.mustChangePassword = True
        user.isActive = True
        db.add(user)
        db.commit()
        print(f"Temporary password for {user.username} ({user.role}): {temp}")
        print("They will be asked to choose a new password when they sign in.")


if __name__ == "__main__":
    main()
