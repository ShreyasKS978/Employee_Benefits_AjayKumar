CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    emp_id VARCHAR(50) NOT NULL,
    program VARCHAR(255) NOT NULL,
    program_time VARCHAR(255),
    request_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    loan_type VARCHAR(100),
    amount NUMERIC,
    reason TEXT,
    document_path VARCHAR(255)
);
