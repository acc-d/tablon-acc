const SUPABASE_URL = "https://pemxfolvirdeymsismaj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlbXhmb2x2aXJkZXltc2lzbWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTAzMzEsImV4cCI6MjA5OTg2NjMzMX0.o7kqBPN8L97Hy4qY993MFvdC-10IM5_K6PNiY-2NNG4";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

export default supabaseClient;