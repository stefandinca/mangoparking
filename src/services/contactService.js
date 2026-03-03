import { addDocument } from '../firebase/db.js';

/**
 * Submit a contact form message
 */
export async function submitContactMessage(data) {
  return addDocument('contactMessages', {
    name: data.name,
    email: data.email,
    subject: data.subject,
    message: data.message,
    status: 'new',
  });
}
