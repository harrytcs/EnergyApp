import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? '';

async function authHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const headers = await authHeaders();
  const url = new URL(`${API_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function put<T>(path: string, body: object): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: object): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface ThermostatState {
  id: string;
  index: number;
  room_name?: string;
  current_temp_f: number;
  heat_setpoint_f: number;
  cool_setpoint_f: number;
  mode: string;
  hvac_status: string;
  humidity_percent: number;
  connectivity: string;
}

export interface Events {
  car_charge_started_at: number | null;
  car_charge_stopped_at: number | null;
  hvac_activated_at: number | null;
  hvac_deactivated_at: number | null;
  last_automation_run: number | null;
  powerwall_full_eta: number | null;
  car_full_eta: number | null;
}

export interface DashboardData {
  latest: EnergyReading | null;
  history: EnergyReading[];
  summary: {
    period_hours: number;
    solar_kwh: number;
    grid_imported_kwh: number;
    grid_exported_kwh: number;
    cost_savings_usd: number;
  };
  settings: {
    automation_enabled: boolean;
    overrides: Overrides;
    car_charge_limit_percent: number;
  };
  thermostats: ThermostatState[];
  events: Events;
  generated_at: number;
}

export interface EnergyReading {
  timestamp: number;
  solar_power_w: number;
  battery_power_w: number;
  load_power_w: number;
  home_load_w?: number;
  grid_power_w: number;
  battery_percentage: number;
  car_battery_level: number;
  car_charging_state: string;
  car_charge_power_w: number;
  hvac_status: string;
  hvac_current_temp_f: number;
  hvac_setpoint_f: number;
  hvac_mode: string;
  solar_surplus_w: number;
  cost_savings_usd: number;
}

export interface Overrides {
  car_force_charge: boolean;
  hvac_force_on: boolean;
  automation_paused: boolean;
  car_trip_mode: boolean;
  car_trip_target_percent: number;
}

export interface Settings {
  automation_enabled: boolean;
  car_charge_limit_percent: number;
  hvac_cool_setpoint_f: number;
  hvac_heat_setpoint_f: number;
  min_surplus_for_car_w: number;
  min_surplus_for_hvac_w: number;
  powerwall_full_threshold: number;
  priority_order: string[];
  notifications: NotificationSettings;
  overrides: Overrides;
  latitude: number | null;
  longitude: number | null;
}

export interface NotificationSettings {
  car_charging_started: boolean;
  car_charging_stopped: boolean;
  car_fully_charged: boolean;
  powerwall_low: boolean;
  powerwall_low_threshold: number;
  hvac_solar_activated: boolean;
  solar_low: boolean;
  solar_low_threshold_w: number;
}

export interface HistoryData {
  timestamps: number[];
  series: Record<string, number[]>;
  count: number;
  hours: number;
}

export interface SavingsPeriod {
  solar_to_home_kwh: number;
  grid_imported_kwh: number;
  savings_usd: number;
}

export interface SavingsData {
  mtd: SavingsPeriod;
  ytd: SavingsPeriod;
  monthly: Array<SavingsPeriod & { year: number; month: number }>;
}

export const api = {
  getDashboard: (hours = 24) =>
    get<DashboardData>('/dashboard', { hours: String(hours) }),

  getHistory: (metrics: string[], hours = 24) =>
    get<HistoryData>('/history', { metrics: metrics.join(','), hours: String(hours) }),

  getSettings: () => get<Settings>('/settings'),

  updateSettings: (settings: Partial<Settings>) => put<Settings>('/settings', settings),

  setOverride: (type: keyof Overrides, enabled: boolean) =>
    post('/settings/override', { type, enabled }),

  getSavings: () => get<SavingsData>('/savings'),
};
