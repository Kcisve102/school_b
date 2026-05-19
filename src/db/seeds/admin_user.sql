-- This is a template. Run this after you generate a password hash for your admin user
-- Example: bcryptjs hash of 'admin123' would be inserted here
-- You'll need to generate this in code and then insert it

-- INSERT INTO users (email, password_hash, full_name, is_admin)
-- VALUES ('admin@example.com', '$2a$10$your_hashed_password_here', 'Admin User', true);

-- To generate the hash, you can run this in Node.js:
-- const bcrypt = require('bcryptjs');
-- const hash = bcrypt.hashSync('your_password', 10);
-- console.log(hash);
