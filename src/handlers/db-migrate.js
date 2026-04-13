import { getPool } from "../lib/db.js";

/**
 * Database migration Lambda.
 * Runs inside the VPC so it can reach RDS directly.
 * Invoked via: aws lambda invoke (see Makefile db-deploy)
 *
 * Executes in order:
 *   1. ALTER DATABASE collation
 *   2. CREATE tables (IF NOT EXISTS)
 *   3. DROP + CREATE stored procedures
 *   4. INSERT seed data (idempotent)
 */
export async function handler() {
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    console.log("Starting database migration...");

    // ── Step 1: Fix collation ──────────────────
    console.log("Step 1: Setting database collation...");
    await conn.query("ALTER DATABASE school_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

    // ── Step 2: Create tables ──────────────────
    console.log("Step 2: Creating tables...");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS grades (
        id TINYINT UNSIGNED NOT NULL,
        name VARCHAR(10) NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_subject_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS grade_subject (
        grade_id TINYINT UNSIGNED NOT NULL,
        subject_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (grade_id, subject_id),
        CONSTRAINT fk_gs_grade FOREIGN KEY (grade_id) REFERENCES grades(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_gs_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS students (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        first_name VARCHAR(60) NOT NULL,
        last_name_father VARCHAR(60) NOT NULL,
        last_name_mother VARCHAR(60) DEFAULT NULL,
        date_of_birth DATE NOT NULL,
        gender ENUM('M', 'F', 'Other') NOT NULL,
        grade_id TINYINT UNSIGNED NOT NULL,
        status ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        CONSTRAINT fk_student_grade FOREIGN KEY (grade_id) REFERENCES grades(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        INDEX idx_student_name (first_name, last_name_father, last_name_mother),
        INDEX idx_student_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        student_id INT UNSIGNED NOT NULL,
        subject_id INT UNSIGNED NOT NULL,
        grade_id TINYINT UNSIGNED NOT NULL,
        year SMALLINT UNSIGNED NOT NULL,
        month TINYINT UNSIGNED NOT NULL,
        score DECIMAL(4,2) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_score (student_id, subject_id, grade_id, year, month),
        CONSTRAINT fk_score_student FOREIGN KEY (student_id) REFERENCES students(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_score_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_score_grade FOREIGN KEY (grade_id) REFERENCES grades(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_score_range CHECK (score >= 0.00 AND score <= 10.00),
        CONSTRAINT chk_month_valid CHECK (month >= 1 AND month <= 12),
        INDEX idx_score_lookup (student_id, grade_id, year, month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(120) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(60) NOT NULL,
        last_name VARCHAR(60) NOT NULL,
        role ENUM('admin', 'teacher') NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_user_email (email),
        INDEX idx_user_role (role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── Step 3: Stored Procedures ──────────────
    console.log("Step 3: Creating stored procedures...");

    // -- Users / Auth --
    await conn.query("DROP PROCEDURE IF EXISTS sp_create_user");
    await conn.query(`
      CREATE PROCEDURE sp_create_user(
        IN p_email VARCHAR(120),
        IN p_password_hash VARCHAR(255),
        IN p_first_name VARCHAR(60),
        IN p_last_name VARCHAR(60),
        IN p_role ENUM('admin', 'teacher')
      )
      BEGIN
        IF p_email IS NULL OR TRIM(p_email) = '' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Email is required.';
        END IF;
        IF p_password_hash IS NULL OR TRIM(p_password_hash) = '' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Password hash is required.';
        END IF;
        IF EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Email already registered.';
        END IF;
        INSERT INTO users (email, password_hash, first_name, last_name, role)
        VALUES (TRIM(LOWER(p_email)), p_password_hash, TRIM(p_first_name), TRIM(p_last_name), p_role);
        SELECT LAST_INSERT_ID() AS user_id;
      END
    `);

    await conn.query("DROP PROCEDURE IF EXISTS sp_get_user_by_email");
    await conn.query(`
      CREATE PROCEDURE sp_get_user_by_email(IN p_email VARCHAR(120))
      BEGIN
        SELECT id, email, password_hash, first_name, last_name, role, is_active
        FROM users WHERE email = TRIM(LOWER(p_email)) AND is_active = TRUE;
      END
    `);

    await conn.query("DROP PROCEDURE IF EXISTS sp_get_user_by_id");
    await conn.query(`
      CREATE PROCEDURE sp_get_user_by_id(IN p_user_id INT UNSIGNED)
      BEGIN
        SELECT id, email, first_name, last_name, role, is_active, created_at
        FROM users WHERE id = p_user_id AND is_active = TRUE;
      END
    `);

    // -- Students CRUD --
    await conn.query("DROP PROCEDURE IF EXISTS sp_create_student");
    await conn.query(`
      CREATE PROCEDURE sp_create_student(
        IN p_first_name VARCHAR(60),
        IN p_last_name_father VARCHAR(60),
        IN p_last_name_mother VARCHAR(60),
        IN p_date_of_birth DATE,
        IN p_gender ENUM('M', 'F', 'Other'),
        IN p_grade_id TINYINT UNSIGNED
      )
      BEGIN
        IF p_first_name IS NULL OR TRIM(p_first_name) = '' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'First name is required.';
        END IF;
        IF p_last_name_father IS NULL OR TRIM(p_last_name_father) = '' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Father last name is required.';
        END IF;
        IF p_date_of_birth IS NULL THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Date of birth is required.';
        END IF;
        IF p_date_of_birth > CURDATE() THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Date of birth cannot be in the future.';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM grades WHERE id = p_grade_id) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Specified grade does not exist.';
        END IF;
        INSERT INTO students (first_name, last_name_father, last_name_mother, date_of_birth, gender, grade_id, status)
        VALUES (TRIM(p_first_name), TRIM(p_last_name_father), TRIM(p_last_name_mother), p_date_of_birth, p_gender, p_grade_id, 'active');
        SELECT LAST_INSERT_ID() AS student_id;
      END
    `);

    await conn.query("DROP PROCEDURE IF EXISTS sp_get_student");
    await conn.query(`
      CREATE PROCEDURE sp_get_student(IN p_student_id INT UNSIGNED)
      BEGIN
        SELECT s.id, s.first_name, s.last_name_father, s.last_name_mother,
               s.date_of_birth, s.gender, s.grade_id, g.name AS grade_name,
               s.status, s.created_at, s.updated_at
        FROM students s
        INNER JOIN grades g ON s.grade_id = g.id
        WHERE s.id = p_student_id;
      END
    `);

    await conn.query("DROP PROCEDURE IF EXISTS sp_search_students");
    await conn.query(`
      CREATE PROCEDURE sp_search_students(
        IN p_term VARCHAR(180),
        IN p_status ENUM('active', 'inactive', 'suspended'),
        IN p_limit INT UNSIGNED,
        IN p_offset INT UNSIGNED
      )
      BEGIN
        SET p_limit = IFNULL(p_limit, 20);
        SET p_offset = IFNULL(p_offset, 0);
        SELECT s.id, s.first_name, s.last_name_father, s.last_name_mother,
               s.date_of_birth, s.gender, s.grade_id, g.name AS grade_name, s.status
        FROM students s
        INNER JOIN grades g ON s.grade_id = g.id
        WHERE (p_term IS NULL OR CONCAT(s.first_name, ' ', s.last_name_father, ' ', IFNULL(s.last_name_mother, '')) LIKE CONCAT('%', p_term, '%'))
          AND (p_status IS NULL OR s.status = p_status)
        ORDER BY s.last_name_father, s.last_name_mother, s.first_name
        LIMIT p_limit OFFSET p_offset;
      END
    `);

    await conn.query("DROP PROCEDURE IF EXISTS sp_update_student");
    await conn.query(`
      CREATE PROCEDURE sp_update_student(
        IN p_student_id INT UNSIGNED,
        IN p_first_name VARCHAR(60),
        IN p_last_name_father VARCHAR(60),
        IN p_last_name_mother VARCHAR(60),
        IN p_date_of_birth DATE,
        IN p_gender ENUM('M', 'F', 'Other'),
        IN p_grade_id TINYINT UNSIGNED,
        IN p_status ENUM('active', 'inactive', 'suspended')
      )
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Student does not exist.';
        END IF;
        IF p_first_name IS NULL OR TRIM(p_first_name) = '' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'First name is required.';
        END IF;
        IF p_last_name_father IS NULL OR TRIM(p_last_name_father) = '' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Father last name is required.';
        END IF;
        IF p_date_of_birth > CURDATE() THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Date of birth cannot be in the future.';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM grades WHERE id = p_grade_id) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Specified grade does not exist.';
        END IF;
        UPDATE students SET
          first_name = TRIM(p_first_name),
          last_name_father = TRIM(p_last_name_father),
          last_name_mother = TRIM(p_last_name_mother),
          date_of_birth = p_date_of_birth,
          gender = p_gender,
          grade_id = p_grade_id,
          status = p_status
        WHERE id = p_student_id;
        SELECT ROW_COUNT() AS rows_affected;
      END
    `);

    await conn.query("DROP PROCEDURE IF EXISTS sp_delete_student");
    await conn.query(`
      CREATE PROCEDURE sp_delete_student(IN p_student_id INT UNSIGNED)
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Student does not exist.';
        END IF;
        UPDATE students SET status = 'inactive' WHERE id = p_student_id;
        SELECT ROW_COUNT() AS rows_affected;
      END
    `);

    // -- Scores --
    await conn.query("DROP PROCEDURE IF EXISTS sp_get_scores");
    await conn.query(`
      CREATE PROCEDURE sp_get_scores(
        IN p_student_id INT UNSIGNED,
        IN p_grade_id TINYINT UNSIGNED,
        IN p_year SMALLINT UNSIGNED,
        IN p_month TINYINT UNSIGNED
      )
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Student does not exist.';
        END IF;
        IF p_month < 1 OR p_month > 12 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Month must be between 1 and 12.';
        END IF;
        SELECT sub.id AS subject_id, sub.name AS subject_name, sc.score,
               CASE WHEN sc.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_recorded,
               sc.updated_at AS recorded_at
        FROM grade_subject gs
        INNER JOIN subjects sub ON gs.subject_id = sub.id
        LEFT JOIN scores sc
          ON sc.student_id = p_student_id
          AND sc.subject_id = sub.id
          AND sc.grade_id = p_grade_id
          AND sc.year = p_year
          AND sc.month = p_month
        WHERE gs.grade_id = p_grade_id
        ORDER BY sub.name;
      END
    `);

    await conn.query("DROP PROCEDURE IF EXISTS sp_record_score");
    await conn.query(`
      CREATE PROCEDURE sp_record_score(
        IN p_student_id INT UNSIGNED,
        IN p_subject_id INT UNSIGNED,
        IN p_grade_id TINYINT UNSIGNED,
        IN p_year SMALLINT UNSIGNED,
        IN p_month TINYINT UNSIGNED,
        IN p_score DECIMAL(4,2)
      )
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Student does not exist.';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM grade_subject WHERE grade_id = p_grade_id AND subject_id = p_subject_id) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subject does not belong to the specified grade.';
        END IF;
        IF p_score < 0.00 OR p_score > 10.00 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Score must be between 0.00 and 10.00.';
        END IF;
        IF p_month < 1 OR p_month > 12 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Month must be between 1 and 12.';
        END IF;
        INSERT INTO scores (student_id, subject_id, grade_id, year, month, score)
        VALUES (p_student_id, p_subject_id, p_grade_id, p_year, p_month, p_score)
        ON DUPLICATE KEY UPDATE score = p_score, updated_at = CURRENT_TIMESTAMP;
        SELECT p_student_id AS student_id, p_subject_id AS subject_id, p_score AS score,
               CASE
                 WHEN ROW_COUNT() = 1 THEN 'created'
                 WHEN ROW_COUNT() = 2 THEN 'updated'
                 ELSE 'no_change'
               END AS operation;
      END
    `);

    // ── Step 4: Seed data ──────────────────────
    console.log("Step 4: Inserting seed data...");

    // Grades
    await conn.query(`
      INSERT INTO grades (id, name) VALUES
        (1,'primero'),(2,'segundo'),(3,'tercero'),(4,'cuarto'),(5,'quinto'),
        (6,'sexto'),(7,'septimo'),(8,'octavo'),(9,'noveno')
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `);

    // Subjects
    await conn.query(`
      INSERT INTO subjects (name) VALUES
        ('Matematicas'),('Espanol'),('Ciencias Naturales'),('Historia'),
        ('Geografia'),('Educacion Civica'),('Educacion Fisica'),
        ('Educacion Artistica'),('Fisica'),('Quimica'),('Biologia'),('Ingles')
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `);

    // Grade-Subject: core subjects for all grades
    await conn.query(`
      INSERT IGNORE INTO grade_subject (grade_id, subject_id)
      SELECT g.id, s.id FROM grades g CROSS JOIN subjects s
      WHERE s.name IN ('Matematicas','Espanol','Historia','Geografia',
                       'Educacion Civica','Educacion Fisica','Educacion Artistica','Ingles')
    `);

    // Natural Sciences for elementary (1-6)
    await conn.query(`
      INSERT IGNORE INTO grade_subject (grade_id, subject_id)
      SELECT g.id, s.id FROM grades g CROSS JOIN subjects s
      WHERE g.id BETWEEN 1 AND 6 AND s.name = 'Ciencias Naturales'
    `);

    // Physics, Chemistry, Biology for middle school (7-9)
    await conn.query(`
      INSERT IGNORE INTO grade_subject (grade_id, subject_id)
      SELECT g.id, s.id FROM grades g CROSS JOIN subjects s
      WHERE g.id BETWEEN 7 AND 9 AND s.name IN ('Fisica','Quimica','Biologia')
    `);

    // Students
    await conn.query(`
      INSERT INTO students (first_name, last_name_father, last_name_mother, date_of_birth, gender, grade_id, status) VALUES
        ('Juan Carlos','Garcia','Lopez','2015-03-15','M',3,'active'),
        ('Maria Fernanda','Martinez','Hernandez','2014-07-22','F',4,'active'),
        ('Pedro','Rodriguez','Sanchez','2013-11-08','M',5,'active'),
        ('Ana Lucia','Lopez','Garcia','2016-01-30','F',2,'active'),
        ('Carlos Eduardo','Hernandez','Torres','2012-09-14','M',7,'active'),
        ('Sofia','Torres','Ramirez','2011-05-03','F',8,'active'),
        ('Diego Alejandro','Ramirez','Flores','2010-12-20','M',9,'active'),
        ('Valentina','Flores','Martinez','2017-04-11','F',1,'active'),
        ('Miguel Angel','Sanchez','Rodriguez','2013-06-25','M',6,'suspended'),
        ('Isabella','Morales','Lopez','2015-08-17','F',3,'inactive')
      ON DUPLICATE KEY UPDATE first_name = VALUES(first_name)
    `);

    // Users (password: password123)
    await conn.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES
        ('admin@school.com','$2b$10$0bSHVVndP2L81/KlIu1/JueNEqNOnrhLPoWuW195lsUnJYGOgz0SG','Admin','Principal','admin'),
        ('maria.teacher@school.com','$2b$10$0bSHVVndP2L81/KlIu1/JueNEqNOnrhLPoWuW195lsUnJYGOgz0SG','Maria','Gonzalez','teacher'),
        ('carlos.teacher@school.com','$2b$10$0bSHVVndP2L81/KlIu1/JueNEqNOnrhLPoWuW195lsUnJYGOgz0SG','Carlos','Rivera','teacher')
      ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)
    `);

    // Demo scores
    const scores = [
      [1, 1, 3, 2026, 1, 9.50], [1, 2, 3, 2026, 1, 8.00], [1, 4, 3, 2026, 1, 7.50],
      [2, 1, 4, 2026, 1, 10.00], [2, 2, 4, 2026, 1, 9.00], [2, 3, 4, 2026, 1, 8.50],
      [2, 4, 4, 2026, 1, 9.20], [2, 5, 4, 2026, 1, 8.80],
      [5, 1, 7, 2026, 1, 7.00], [5, 9, 7, 2026, 1, 8.50], [5, 10, 7, 2026, 1, 9.00],
    ];
    for (const s of scores) {
      await conn.query("CALL sp_record_score(?, ?, ?, ?, ?, ?)", s);
    }

    console.log("Migration completed successfully.");
    return { statusCode: 200, body: JSON.stringify({ message: "Database migrated successfully" }) };

  } catch (err) {
    console.error("Migration failed:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    conn.release();
  }
}
