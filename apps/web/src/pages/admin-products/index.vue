<script setup lang="ts">
import { PackageSearch } from '@lucide/vue';
import { reactive } from 'vue';
import { Badge } from '@/components/ui/badge';
import AdminPagination from '@/components/shared/AdminPagination.vue';
import ProductDetailDialog from './components/ProductDetailDialog.vue';
import ProductFilters from './components/ProductFilters.vue';
import ProductTable from './components/ProductTable.vue';
import { useAdminProductsPage } from './page';

const page = reactive(useAdminProductsPage());
</script>

<template>
  <section class="flex min-w-0 flex-col gap-6 py-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold">商品目录</h1>
      </div>
      <Badge variant="secondary">
        <PackageSearch data-icon="inline-start" />
        {{ page.total }} 件商品
      </Badge>
    </div>
    <div class="flex min-w-0 flex-col gap-5">
      <ProductFilters
        :keyword="page.filters.keyword"
        :category="page.filters.category"
        :is-active="page.filters.isActive"
        :in-stock="page.filters.inStock"
        :loading="page.loading"
        :categories="page.categories"
        @update:keyword="
          page.filters.keyword = $event;
          page.resetPageAndLoad();
        "
        @update:category="
          page.filters.category = $event;
          page.resetPageAndLoad();
        "
        @update:is-active="
          page.filters.isActive = $event;
          page.resetPageAndLoad();
        "
        @update:in-stock="
          page.filters.inStock = $event;
          page.resetPageAndLoad();
        "
        @refresh="page.loadProducts"
      />
      <ProductTable
        :products="page.products"
        :loading="page.loading"
        :error="page.error"
        @select="page.openDetail"
      />
      <AdminPagination
        :page="page.page"
        :page-size="page.pageSize"
        :total="page.total"
        :disabled="page.loading"
        @update:page="page.setPage"
      />
    </div>
    <ProductDetailDialog
      :open="page.detailOpen"
      :loading="page.detailLoading"
      :error="page.detailError"
      :product="page.selectedProduct"
      :try-on-enabled="page.tryOnDraft"
      :try-on-switch-disabled="page.tryOnSwitchDisabled"
      :try-on-disabled-reason="page.tryOnDisabledReason"
      :try-on-saving="page.tryOnSaving"
      :can-save-try-on="page.canSaveTryOn"
      :try-on-save-result-unknown="page.tryOnSaveResultUnknown"
      :can-upload-image="page.canUploadImage"
      :image-uploading="page.imageUploading"
      :image-upload-result-unknown="page.imageUploadResultUnknown"
      :image-preview-status="page.imagePreviewStatus"
      :image-preview-url="page.imagePreviewUrl"
      @update:open="!$event && page.closeDetail()"
      @update:try-on-enabled="page.setTryOnDraft"
      @save-try-on="page.saveTryOn"
      @retry="page.retryDetail"
      @upload-image="page.uploadTryOnImage"
      @retry-image="page.loadImagePreview"
      @image-error="page.imagePreviewFailed"
    />
  </section>
</template>
