import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto implements Partial<CreateProductDto> {
  categoryId?: number;
  brand?: string;
  name?: string;
  sku?: string;
  price?: number;
  currency?: string;
  stockStatus?: 'disponible' | 'a_pedido' | 'sin_stock';
  description?: string;
  specs?: Record<string, any>;
  datasheetUrl?: string;
  active?: boolean; // false = desactivado: no se usa en ningún lado, sin borrarlo
  showInStore?: boolean; // false = fuera de la tienda; el dimensionador lo sigue usando
}
