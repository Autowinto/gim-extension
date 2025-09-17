using DemoLib;

class Program
{
    static void Main()
    {
        var calc = new Calculator();

        int a = 10, b = 5;
        Console.WriteLine($"Add: {calc.Add(a, b)}");
        Console.WriteLine($"Subtract: {calc.Subtract(a, b)}");
        Console.WriteLine($"Multiply: {calc.Multiply(a, b)}");
        Console.WriteLine($"Divide: {calc.Divide(a, b)}");

        Console.WriteLine($"Square: {MathUtils.Square(a)}");
        Console.WriteLine($"Sum: {MathUtils.Sum(1, 2, 3, 4, 5)}");
    }
}
