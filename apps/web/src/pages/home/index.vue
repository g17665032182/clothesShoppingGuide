<script setup lang="ts">
import HomeHero from './components/HomeHero.vue';
import { useHomePage } from './page';

const { auth } = useHomePage();
const { isAdmin, state } = auth;
</script>

<template>
  <HomeHero :is-admin="isAdmin" :user="state.user" />
</template>
