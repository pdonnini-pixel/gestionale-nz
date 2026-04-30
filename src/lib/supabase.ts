import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || 'https://xfvfxsvqpnpvibgeqpqp.supabase.co'
const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdmZ4c3ZxcG5wdmliZ2VxcHFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNDkwNDcsImV4cCI6MjA5MDcyNTA0N30.ohYziAXiOWS0TKU9HHuhUAbf5Geh10xbLGEoftOMJZA'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
