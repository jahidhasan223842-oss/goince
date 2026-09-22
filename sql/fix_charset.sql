-- Ei script ta ekbar Import korle apnar database-e JOTO table ache
-- (product_colors thakuk ba na thakuk, kono difference nei) shobgulo
-- automatically utf8mb4-e convert hoye jabe. Kono table hardcode kora
-- nei, tai "Table doesn't exist" error kokhono ashbe na.
--
-- Kono data muchbe na, shudhu encoding thik korbe (emoji shoho shob
-- lekha shothikvabe save korte parben).

DROP PROCEDURE IF EXISTS convert_all_tables_to_utf8mb4;

DELIMITER $$

CREATE PROCEDURE convert_all_tables_to_utf8mb4()
BEGIN
  DECLARE done INT DEFAULT FALSE;
  DECLARE tbl_name VARCHAR(255);
  DECLARE cur CURSOR FOR
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  OPEN cur;

  read_loop: LOOP
    FETCH cur INTO tbl_name;
    IF done THEN
      LEAVE read_loop;
    END IF;

    SET @stmt = CONCAT('ALTER TABLE `', tbl_name, '` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
    PREPARE dynamic_stmt FROM @stmt;
    EXECUTE dynamic_stmt;
    DEALLOCATE PREPARE dynamic_stmt;
  END LOOP;

  CLOSE cur;
END$$

DELIMITER ;

-- Procedure ta call kore shob table convert kore niলাম
CALL convert_all_tables_to_utf8mb4();

-- Kaj shesh hole procedure ta remove kore dilam, ar dorkar nei
DROP PROCEDURE IF EXISTS convert_all_tables_to_utf8mb4;

-- Database-er nijer default charset-o utf8mb4 kore dilam, jate
-- bhobishyote je kono notun table automatically shothik charset pay
SET @dbname = DATABASE();
SET @alter_db_stmt = CONCAT('ALTER DATABASE `', @dbname, '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
PREPARE alter_db FROM @alter_db_stmt;
EXECUTE alter_db;
DEALLOCATE PREPARE alter_db;
