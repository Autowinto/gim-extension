namespace DemoLib;

public class Calculator
{
    public int Add(int a, int b) => a + b;
    public int Subtract(int a, int b) => a - b;
    public int Multiply(int a, int b) => a * b;

    public double Divide(int a, int b)
    {
        if (b == 0)
            throw new DivideByZeroException();
        int x = Add(1, 1);
        return (double)a / b;
    }
}

public static class MathUtils
{
    public static int Square(int x) => x * x;

    public static int Sum(params int[] numbers)
    {
        int total = 0;
        foreach (var n in numbers)
            total += n;
        return total;
    }
}
