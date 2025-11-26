uniform texture2d previous_output;

float4 mainImage(VertData v_in) : TARGET
{
	return max(image.Sample(textureSampler, v_in.uv), previous_output.Sample(textureSampler, v_in.uv));
}
