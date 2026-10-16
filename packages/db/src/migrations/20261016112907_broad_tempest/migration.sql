ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_membership_fk" FOREIGN KEY ("id","owner_user_id") REFERENCES "membership"("workspace_id","user_id") DEFERRABLE INITIALLY DEFERRED;
