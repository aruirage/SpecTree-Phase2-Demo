import DefaultLayout from '../layouts/default.vue';

const routes = [
  {
    path: '/',
    name: 'home',
    redirect: '/spec-tree',
    component: DefaultLayout,
    children: [
      {
        path: 'spec-tree',
        name: 'SpecTree',
        component: () => import('../views/SpecTree/index.vue'),
        meta: { title: 'スペックツリー' }
      },
      {
        path: 'clause-comparison',
        name: 'ClauseComparison',
        component: () => import('../views/ClauseComparison/index.vue'),
        meta: { title: '条項比較' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../views/NotFound.vue')
  }
];

export default routes;
