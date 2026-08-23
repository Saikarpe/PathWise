/**
 * Every backend call the UI makes, in one place.
 *
 * Grouped by router so this file reads as a map of the API surface. Components
 * import from here and never build URLs themselves, which means a route change is
 * a one-line edit and a typo is a build-time-visible missing export rather than a
 * 404 at runtime.
 */
import { api } from './client'

const body = (response) => response.data

export const meta = {
  health: () => api.get('/api/health').then(body),
}

export const auth = {
  register: (payload) => api.post('/api/auth/register', payload).then(body),
  login: (payload) => api.post('/api/auth/login', payload).then(body),
  demoLogin: (email) =>
    api.post('/api/auth/demo-login', null, { params: email ? { email } : {} }).then(body),
  demoUsers: () => api.get('/api/auth/demo-users').then(body),
  me: () => api.get('/api/auth/me').then(body),
}

export const profile = {
  read: () => api.get('/api/profile').then(body),
  update: (payload) => api.put('/api/profile', payload).then(body),
  interpret: (text) => api.post('/api/profile/interpret', { text }).then(body),
  skills: () => api.get('/api/profile/skills').then(body),
  history: () => api.get('/api/profile/history').then(body),
  vocabulary: () => api.get('/api/profile/vocabulary').then(body),
}

export const paths = {
  generate: (payload = {}) => api.post('/api/paths/generate', payload).then(body),
  preview: (goalText) =>
    api.post('/api/paths/generate', { goal_text: goalText || null, preview: true }).then(body),
  list: () => api.get('/api/paths').then(body),
  active: () => api.get('/api/paths/active').then(body),
  read: (pathId) => api.get(`/api/paths/${pathId}`).then(body),
  graph: (pathId) => api.get(`/api/paths/${pathId}/graph`).then(body),
  explainItem: (pathId, itemId) =>
    api.get(`/api/paths/${pathId}/items/${itemId}/explain`).then(body),
  progress: (pathId, payload) => api.post(`/api/paths/${pathId}/progress`, payload).then(body),
  archive: (pathId) => api.post(`/api/paths/${pathId}/archive`).then(body),
  activate: (pathId) => api.post(`/api/paths/${pathId}/activate`).then(body),
  remove: (pathId) => api.delete(`/api/paths/${pathId}`).then(body),
}

export const recommendations = {
  list: (payload = {}) => api.post('/api/recommendations', payload).then(body),
  similar: (courseId, limit = 6) =>
    api.get(`/api/recommendations/similar/${encodeURIComponent(courseId)}`, { params: { limit } })
      .then(body),
  feedback: (payload) => api.post('/api/recommendations/feedback', payload).then(body),
  model: () => api.get('/api/recommendations/model').then(body),
}

export const dashboard = {
  read: () => api.get('/api/dashboard').then(body),
  next: (limit = 3) => api.get('/api/dashboard/next', { params: { limit } }).then(body),
  activity: () => api.get('/api/dashboard/activity').then(body),
}

export const chat = {
  send: (message, sessionId = 'default') =>
    api.post('/api/chat', { message, session_id: sessionId }).then(body),
  history: (sessionId = 'default') =>
    api.get('/api/chat/history', { params: { session_id: sessionId } }).then(body),
  clear: (sessionId = 'default') =>
    api.delete('/api/chat/history', { params: { session_id: sessionId } }).then(body),
}

export const catalog = {
  stats: () => api.get('/api/catalog/stats').then(body),
  search: (payload) => api.post('/api/catalog/search', payload).then(body),
  taxonomy: () => api.get('/api/catalog/taxonomy').then(body),
  course: (courseId) => api.get(`/api/catalog/courses/${encodeURIComponent(courseId)}`).then(body),
  skill: (skill, limit = 8) =>
    api.get(`/api/catalog/skills/${encodeURIComponent(skill)}`, { params: { limit } }).then(body),
}
