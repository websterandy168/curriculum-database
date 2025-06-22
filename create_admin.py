import os
from dotenv import load_dotenv
from app import app, db, User

load_dotenv()

# --- Configuration ---
# This script will create an admin user with the following credentials.
# The admin password will be read from an environment variable for security.
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin') # Default to 'admin' if not set
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')
# --- End Configuration ---

def create_admin():
    """Creates or updates the admin user in the database."""
    with app.app_context():
        if not ADMIN_PASSWORD:
            print("Error: ADMIN_PASSWORD not found in environment or .env file.")
            print("Please ensure ADMIN_PASSWORD is set in your .env file.")
            return

        user = User.query.filter_by(username=ADMIN_USERNAME).first()

        if user:
            print(f"User '{ADMIN_USERNAME}' already exists. Updating password.")
            user.set_password(ADMIN_PASSWORD)
        else:
            print(f"Creating new admin user: '{ADMIN_USERNAME}'")
            user = User(username=ADMIN_USERNAME)
            user.set_password(ADMIN_PASSWORD)
            db.session.add(user)

        db.session.commit()
        print(f"Admin user '{ADMIN_USERNAME}' has been configured successfully.")

if __name__ == '__main__':
    create_admin()