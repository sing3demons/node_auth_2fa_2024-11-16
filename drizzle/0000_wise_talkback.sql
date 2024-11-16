CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'member',
	"2faEnable" boolean DEFAULT false,
	"2faSecret" varchar(255),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
