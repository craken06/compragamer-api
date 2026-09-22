export class CreateProductDto {
  categoryId: number;
  brand: string;
  name: string;
  sku?: string;
  price: number;
  currency?: string;
  stockStatus?: 'disponible' | 'a_pedido' | 'sin_stock';
  description?: string;
  specs?: Record<string, any>;
  datasheetUrl?: string;
}
