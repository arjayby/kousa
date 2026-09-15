CREATE TABLE "credit_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"polar_order_id" text NOT NULL,
	"polar_checkout_id" text NOT NULL,
	"polar_customer_id" text NOT NULL,
	"polar_product_id" text NOT NULL,
	"credits" integer NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grant_polar_order_id_unique" UNIQUE("polar_order_id"),
	CONSTRAINT "credit_grant_polar_checkout_id_unique" UNIQUE("polar_checkout_id"),
	CONSTRAINT "credit_grant_positive_credits" CHECK ("credit_grant"."credits" > 0),
	CONSTRAINT "credit_grant_positive_amount" CHECK ("credit_grant"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "credit_grant" ADD CONSTRAINT "credit_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_grant_user_id_idx" ON "credit_grant" USING btree ("user_id");