import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', component: () => import('../views/Dashboard.vue') },
  { path: '/service-reception', component: () => import('../views/ServiceReception.vue') },
  { path: '/work-orders', component: () => import('../views/WorkOrders.vue') },
  { path: '/customers', component: () => import('../views/Customers.vue') },
  { path: '/vehicles', component: () => import('../views/Vehicles.vue') },
{ path: '/parts', component: () => import('../views/Parts.vue') },
{ path: '/profit-report', redirect: { path: '/current-accounts', query: { tab: 'karlilik' } } },
{ path: '/daily-closing', component: () => import('../views/DailyClosing.vue') },
  { path: '/current-accounts', component: () => import('../views/CurrentAccounts.vue') },
  { path: '/settings', component: () => import('../views/Settings.vue') },
  { path: '/help', component: () => import('../views/Help.vue') }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
