import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { getCurrentTenant } from './tenants'

const tenant = getCurrentTenant()

export const supabase = createClient<Database>(tenant.supabaseUrl, tenant.supabaseAnonKey)
