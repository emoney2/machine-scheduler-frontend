// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_KEY;

// Simple safety check – this will log in the browser console if env vars are missing
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables. Check REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_KEY in your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
