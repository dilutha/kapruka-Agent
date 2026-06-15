import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface CachedProduct {
  id: string;
  name: string;
  category: string;
  priceMin: number;
  priceMax?: number;
  currency: string;
  isAvailable: boolean;
  imageUrls: string[];
}

export interface ProductCacheInput extends CachedProduct {
  nameEn?: string;
  nameSi?: string;
  subcategory?: string;
  tags?: string[];
  description?: string;
}

@Injectable()
export class ProductCacheRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByQuery(query: string): Promise<CachedProduct[]> {
    const products = await this.prisma.productCache.findMany({
      where: {
        expiresAt: { gt: new Date() },
        isAvailable: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
          { tags: { has: query.toLowerCase() } },
        ],
      },
      orderBy: { fetchedAt: 'desc' },
      take: 8,
    });

    return products.map((product) => ({
      id: product.kaprukaProdId,
      name: product.name,
      category: product.category,
      priceMin: product.priceMin.toNumber(),
      priceMax: product.priceMax.toNumber(),
      currency: product.currency,
      isAvailable: product.isAvailable,
      imageUrls: product.imageUrls,
    }));
  }

  async upsertMany(products: ProductCacheInput[]): Promise<void> {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.prisma.$transaction(
      products.map((product) =>
        this.prisma.productCache.upsert({
          where: { kaprukaProdId: product.id },
          create: {
            kaprukaProdId: product.id,
            name: product.name,
            nameEn: product.nameEn,
            nameSi: product.nameSi,
            category: product.category,
            subcategory: product.subcategory,
            priceMin: new Prisma.Decimal(product.priceMin),
            priceMax: new Prisma.Decimal(product.priceMax ?? product.priceMin),
            currency: product.currency,
            isAvailable: product.isAvailable,
            imageUrls: product.imageUrls,
            tags: product.tags ?? [],
            rawData: product as unknown as Prisma.InputJsonValue,
            expiresAt,
          },
          update: {
            name: product.name,
            nameEn: product.nameEn,
            nameSi: product.nameSi,
            category: product.category,
            subcategory: product.subcategory,
            priceMin: new Prisma.Decimal(product.priceMin),
            priceMax: new Prisma.Decimal(product.priceMax ?? product.priceMin),
            currency: product.currency,
            isAvailable: product.isAvailable,
            imageUrls: product.imageUrls,
            tags: product.tags ?? [],
            rawData: product as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            expiresAt,
          },
        }),
      ),
    );
  }
}
