import { getCollection, subscribeCollection, updateDocument } from '../firebase/db.js';
import { auditLog } from './auditService.js';

// Fallback mock data
const MOCK_SHUTTLE = [
  { id: 's1', route: 'parking_to_airport', departureTime: '06:00', dayOfWeek: 'all', status: 'scheduled' },
  { id: 's2', route: 'airport_to_parking', departureTime: '06:15', dayOfWeek: 'all', status: 'scheduled' },
  { id: 's3', route: 'parking_to_train', departureTime: '06:30', dayOfWeek: 'weekday', status: 'scheduled' },
  { id: 's4', route: 'parking_to_airport', departureTime: '06:45', dayOfWeek: 'all', status: 'scheduled' },
  { id: 's5', route: 'airport_to_parking', departureTime: '07:00', dayOfWeek: 'all', status: 'scheduled' },
  { id: 's6', route: 'parking_to_train', departureTime: '07:15', dayOfWeek: 'weekday', status: 'scheduled' },
  { id: 's7', route: 'parking_to_airport', departureTime: '07:30', dayOfWeek: 'all', status: 'scheduled' },
  { id: 's8', route: 'train_to_parking', departureTime: '07:45', dayOfWeek: 'weekday', status: 'scheduled' },
  { id: 's9', route: 'parking_to_airport', departureTime: '08:00', dayOfWeek: 'all', status: 'scheduled' },
  { id: 's10', route: 'airport_to_parking', departureTime: '08:15', dayOfWeek: 'all', status: 'scheduled' },
];

const MOCK_TRAINS = [
  { id: 't1', direction: 'to_bucharest', departureTime: '06:22' },
  { id: 't2', direction: 'from_bucharest', departureTime: '06:48' },
  { id: 't3', direction: 'to_bucharest', departureTime: '07:22' },
  { id: 't4', direction: 'from_bucharest', departureTime: '07:48' },
  { id: 't5', direction: 'to_bucharest', departureTime: '08:22' },
];

const MOCK_FLIGHTS = [
  { flight: 'W6 3152', destination: 'London Luton', airline: 'Wizz Air', time: '06:45' },
  { flight: 'RO 371', destination: 'Paris CDG', airline: 'TAROM', time: '08:30' },
  { flight: 'FR 1174', destination: 'Barcelona', airline: 'Ryanair', time: '09:15' },
];

/**
 * Get shuttle schedule
 */
export async function getShuttleSchedule() {
  try {
    const schedule = await getCollection('shuttleSchedule');
    return schedule.length > 0 ? schedule : MOCK_SHUTTLE;
  } catch {
    return MOCK_SHUTTLE;
  }
}

/**
 * Get train schedule
 */
export async function getTrainSchedule() {
  try {
    const schedule = await getCollection('trainSchedule');
    return schedule.length > 0 ? schedule : MOCK_TRAINS;
  } catch {
    return MOCK_TRAINS;
  }
}

/**
 * Get popular flights
 */
export function getPopularFlights() {
  return MOCK_FLIGHTS;
}

/**
 * Subscribe to shuttle schedule updates
 */
export function subscribeShuttle(callback) {
  return subscribeCollection('shuttleSchedule', (data) => {
    callback(data.length > 0 ? data : MOCK_SHUTTLE);
  });
}

/**
 * Get next upcoming departures from now
 */
export function getUpcomingDepartures(schedule, count = 4) {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const upcoming = schedule
    .filter((s) => s.departureTime >= currentTime && s.status !== 'cancelled')
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
    .slice(0, count);

  // If not enough, wrap around to start of day
  if (upcoming.length < count) {
    const remaining = schedule
      .filter((s) => s.departureTime < currentTime && s.status !== 'cancelled')
      .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
      .slice(0, count - upcoming.length);
    upcoming.push(...remaining);
  }

  return upcoming;
}

/**
 * Get route display name i18n key
 */
/**
 * Update shuttle status
 */
export async function updateShuttleStatus(id, status) {
  await updateDocument('shuttleSchedule', id, { status });
  await auditLog('shuttle_updated', 'shuttle', id, null, { status });
}

export function getRouteKey(route) {
  const map = {
    parking_to_airport: 'parkingToAirport',
    airport_to_parking: 'airportToParking',
    parking_to_train: 'parkingToTrain',
    train_to_parking: 'trainToParking',
  };
  return map[route] || route;
}
