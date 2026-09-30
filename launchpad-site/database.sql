-- LaunchPad.dev tables.
-- You do NOT need to run this: server.js creates the database and these tables automatically on start-up.
-- It is here so you can read the structure (or run it by hand in MySQL Workbench after `USE launchpad_site;`).

CREATE TABLE IF NOT EXISTS users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(50)  NOT NULL,
  email          VARCHAR(254) NOT NULL UNIQUE,
  password_hash  VARCHAR(100) NOT NULL,
  role           ENUM('student','mentor') NOT NULL DEFAULT 'student',
  email_verified TINYINT(1)   NOT NULL DEFAULT 0,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME  NOT NULL,
  INDEX idx_sessions_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_verifications (
  user_id      BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  code_hash    CHAR(64) NOT NULL,
  expires_at   DATETIME NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  last_sent_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_resets (
  user_id      BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  code_hash    CHAR(64) NOT NULL,
  expires_at   DATETIME NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  last_sent_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id            BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  plan               ENUM('free','pro') NOT NULL DEFAULT 'free',
  billing            ENUM('monthly','annual') NOT NULL DEFAULT 'monthly',
  current_period_end DATETIME NULL,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  reference  VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  billing    ENUM('monthly','annual') NOT NULL,
  amount     INT NOT NULL,
  status     ENUM('pending','paid') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at    DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mentors (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL UNIQUE,
  name          VARCHAR(50)  NOT NULL,
  role_title    VARCHAR(100) NOT NULL DEFAULT '',
  location      VARCHAR(100) NOT NULL DEFAULT '',
  about         TEXT NULL,
  skills        TEXT NULL,
  experience    TEXT NULL,
  contact_email VARCHAR(254) NOT NULL DEFAULT '',
  contact_phone VARCHAR(40)  NOT NULL DEFAULT '',
  linkedin      VARCHAR(255) NOT NULL DEFAULT '',
  photo         MEDIUMTEXT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key   VARCHAR(50)  NOT NULL PRIMARY KEY,
  setting_value VARCHAR(500) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS contact_messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(254) NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
