import { Module } from '@nestjs/common';
import { ProductCacheRepository } from './repositories/product-cache.repository';

@Module({
  providers: [ProductCacheRepository],
  exports: [ProductCacheRepository],
})
export class ProductModule {}
